const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { uploadPolicy } = require("../config/upload-policy");

const TEXT_LIKE_EXTENSIONS = new Set([".txt", ".csv", ".json"]);
const TEXT_LIKE_MIME_PREFIXES = ["text/"];
const TEXT_LIKE_EXACT_MIMES = new Set([
  "application/json",
  "text/json",
  "application/csv"
]);

function normalizeExtension(filename = "") {
  return path.extname(filename).toLowerCase().trim();
}

function normalizeMime(mime = "") {
  return String(mime).split(";")[0].trim().toLowerCase();
}

function isDeniedExtension(extension) {
  return uploadPolicy.denyExtensions.includes(extension);
}

function isDeniedMimePrefix(mime) {
  if (!mime) return false;
  return uploadPolicy.denyMimePrefixes.some((prefix) => mime.startsWith(prefix));
}

function isTextLikeFallback(extension, declaredMime) {
  if (TEXT_LIKE_EXTENSIONS.has(extension)) return true;
  if (TEXT_LIKE_EXACT_MIMES.has(declaredMime)) return true;
  return TEXT_LIKE_MIME_PREFIXES.some((prefix) => declaredMime.startsWith(prefix));
}

function findRuleByExtension(extension) {
  return uploadPolicy.allowRules.find((rule) =>
    rule.extensions.includes(extension)
  );
}

function findRuleByMime(mime) {
  if (!mime) return null;
  return uploadPolicy.allowRules.find((rule) => rule.mime.includes(mime));
}

function matchRule({ extension, detectedMime, declaredMime }) {
  const byExtension = findRuleByExtension(extension);
  const byDetectedMime = findRuleByMime(detectedMime);
  const byDeclaredMime = findRuleByMime(declaredMime);

  return {
    byExtension,
    byDetectedMime,
    byDeclaredMime,
    selectedRule: byExtension || byDetectedMime || byDeclaredMime || null
  };
}

function buildFail(code, message, extra = {}) {
  return {
    ok: false,
    code,
    message,
    ...extra
  };
}

function buildSuccess(data) {
  return {
    ok: true,
    ...data
  };
}

async function detectFileType(filePath) {
  try {
    const { fileTypeFromFile } = await import("file-type");

    const detected = await fileTypeFromFile(filePath);

    if (!detected) {
      return {
        detectedMimeType: null,
        detectedExtension: null
      };
    }

    return {
      detectedMimeType: normalizeMime(detected.mime),
      detectedExtension: `.${String(detected.ext).toLowerCase()}`
    };
  } catch {
    return {
      detectedMimeType: null,
      detectedExtension: null
    };
  }
}

function computeSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function validateUploadedFile(file) {
  if (!file?.path) {
    return buildFail("FILE_MISSING", "Uploaded file path is missing.");
  }

  const originalName = file.originalname || "";
  const declaredMimeType = normalizeMime(file.mimetype);
  const extension = normalizeExtension(originalName);

  if (!extension) {
    return buildFail("MISSING_EXTENSION", "File must have an extension.", {
      originalName,
      declaredMimeType
    });
  }

  if (isDeniedExtension(extension)) {
    return buildFail("DISALLOWED_EXTENSION", "This file extension is not allowed.", {
      originalName,
      extension,
      declaredMimeType
    });
  }

  const stat = await fs.stat(file.path);

  if (!stat.isFile()) {
    return buildFail("INVALID_FILE", "Uploaded item is not a valid file.", {
      originalName
    });
  }

  if (stat.size <= 0) {
    return buildFail("EMPTY_FILE", "Empty files are not allowed.", {
      originalName,
      extension
    });
  }

  const { detectedMimeType, detectedExtension } = await detectFileType(file.path);

  if (isDeniedMimePrefix(detectedMimeType || "")) {
    return buildFail("DISALLOWED_MIME", "Detected file type is not allowed.", {
      originalName,
      extension,
      declaredMimeType,
      detectedMimeType
    });
  }

  const { byExtension, selectedRule } = matchRule({
    extension,
    detectedMime: detectedMimeType,
    declaredMime: declaredMimeType
  });

  if (!selectedRule) {
    return buildFail("TYPE_NOT_ALLOWED", "This file type is not allowed.", {
      originalName,
      extension,
      declaredMimeType,
      detectedMimeType
    });
  }

  if (stat.size > selectedRule.maxSizeBytes) {
    return buildFail("FILE_TOO_LARGE", "File exceeds allowed size for this type.", {
      originalName,
      extension,
      declaredMimeType,
      detectedMimeType,
      maxSizeBytes: selectedRule.maxSizeBytes,
      actualSizeBytes: stat.size,
      ruleName: selectedRule.name
    });
  }

  if (detectedMimeType && byExtension && !byExtension.mime.includes(detectedMimeType)) {
    return buildFail(
      "MIME_EXTENSION_MISMATCH",
      "File content does not match its extension.",
      {
        originalName,
        extension,
        declaredMimeType,
        detectedMimeType,
        ruleName: byExtension.name
      }
    );
  }

  const usingTextFallback =
    !detectedMimeType && byExtension && isTextLikeFallback(extension, declaredMimeType);

  if (!detectedMimeType && !usingTextFallback) {
    return buildFail(
      "UNDETECTABLE_FILE_TYPE",
      "Could not safely determine the file type.",
      {
        originalName,
        extension,
        declaredMimeType
      }
    );
  }

  const trustedMimeType =
    detectedMimeType || (usingTextFallback ? byExtension.mime[0] : null);

  if (!trustedMimeType) {
    return buildFail(
      "TRUSTED_MIME_UNAVAILABLE",
      "Could not determine a trusted MIME type.",
      {
        originalName,
        extension,
        declaredMimeType,
        detectedMimeType
      }
    );
  }

  const checksumSha256 = await computeSha256(file.path);

  return buildSuccess({
    originalName,
    extension,
    declaredMimeType: declaredMimeType || null,
    detectedMimeType,
    trustedMimeType,
    size: stat.size,
    ruleName: selectedRule.name,
    detectedExtension,
    usedTextFallback: usingTextFallback,
    checksumSha256
  });
}

module.exports = {
  validateUploadedFile
};
