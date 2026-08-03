const fs = require("fs");
const path = require("path");
const fileService = require("../services/file.service");

function shouldForceAttachment(mimeType, fileName) {
  const mime = String(mimeType || "").toLowerCase();
  const ext = path.extname(String(fileName || "")).toLowerCase();

  const inlineMimePrefixes = ["image/", "text/", "video/", "audio/"];

  const inlineExactMimes = new Set(["application/pdf"]);

  const riskyExtensions = new Set([
    ".svg",
    ".html",
    ".htm",
    ".xml",
    ".js",
    ".mjs",
    ".cjs",
  ]);

  if (riskyExtensions.has(ext)) {
    return true;
  }

  if (inlineExactMimes.has(mime)) {
    return false;
  }

  if (inlineMimePrefixes.some((prefix) => mime.startsWith(prefix))) {
    return false;
  }

  if (!mime) {
    return true;
  }

  return true;
}
function isVideo(mimeType) {
  return String(mimeType || "").startsWith("video/");
}

function parseByteRange(value, fileSize) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(value || "").trim());

  if (!match || (!match[1] && !match[2])) return null;

  let start;
  let end;

  if (!match[1]) {
    const suffixLength = Number.parseInt(match[2], 10);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  } else {
    start = Number.parseInt(match[1], 10);
    end = match[2] ? Number.parseInt(match[2], 10) : fileSize - 1;
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= fileSize
  ) {
    return null;
  }

  return { start, end: Math.min(end, fileSize - 1) };
}

function streamFile(res, next, filePath, options) {
  const stream = fs.createReadStream(filePath, options);
  stream.on("error", (error) => {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    next(error);
  });
  return stream.pipe(res);
}

exports.uploadFile = async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "FILE_REQUIRED" });
    }

    const tenant = req.fileTarget?.tenant || req.params[0];
    const folder = req.fileTarget?.folder || req.params[1];
    const visibility = req.query.visibility;
    const overwrite = req.query.overwrite;

    const saved = await fileService.handleUpload({
      tenant,
      folder,
      file,
      visibilityInput: visibility,
      overwriteInput: overwrite,
      metadataInput: req.body?.metadata,
      auth: req.auth,
    });

    const url = `/files/document/${tenant}/${saved.publicId}`;

    res.json({
      message: "File uploaded successfully",
      visibility: saved.visibility,
      overwrite: saved.overwrite,
      renamedBecauseExists: saved.wasRenamed,
      file: {
        id: saved.id,
        documentId: saved.publicId,
        originalFilename: saved.originalName,
        storedName: saved.storedName,
        mimeType: saved.mimeType,
        size: saved.size,
        checksumSha256: saved.checksumSha256,
        status: saved.status,
        tags: saved.tags,
        url,
      },
    });
  } catch (err) {
    console.error(err);

    return res.status(err.status || 500).json({
      error: err.code || "UPLOAD_FAILED",
      message: err.message || "Upload failed",
      details: err.details || undefined,
    });
  }
};

function serveAuthorizedFile(req, res, next, result) {
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  try {
    const metadata = result.metadata;
    const trustedMimeType = metadata.mimeType || "application/octet-stream";
    const stat = fs.statSync(result.diskPath);
    const fileSize = stat.size;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.type(trustedMimeType);

    if (metadata.visibility === "public") {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      res.setHeader("Cache-Control", "private, no-store");
    }

    const forceAttachment = shouldForceAttachment(
      trustedMimeType,
      metadata.originalName || metadata.storedName,
    );

    if (forceAttachment) {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(metadata.originalName || metadata.storedName)}"`,
      );
    }
    if (isVideo(trustedMimeType)) {
      const range = req.headers.range;

      if (range) {
        const parsedRange = parseByteRange(range, fileSize);

        if (!parsedRange) {
          res.setHeader("Content-Range", `bytes */${fileSize}`);
          return res.status(416).json({ error: "INVALID_RANGE" });
        }

        const { start, end } = parsedRange;

        const chunkSize = end - start + 1;

        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize,
          "Content-Type": trustedMimeType,
        });

        return streamFile(res, next, result.diskPath, { start, end });
      } else {
        res.writeHead(200, {
          "Content-Length": fileSize,
          "Content-Type": trustedMimeType,
          "Accept-Ranges": "bytes",
        });

        return streamFile(res, next, result.diskPath);
      }
    }

    res.setHeader("Content-Length", fileSize);
    return streamFile(res, next, result.diskPath);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "READ_FAILED" });
  }
}

exports.serveAuthorizedFile = serveAuthorizedFile;

exports.getFile = async (req, res, next) => {
  try {
    const result = await fileService.getAuthorizedFileForRead({
      tenant: req.params[0],
      relativePath: req.params[1],
      auth: req.auth,
    });
    return serveAuthorizedFile(req, res, next, result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "READ_FAILED" });
  }
};

exports.getFileByDocumentId = async (req, res, next) => {
  try {
    const result = await fileService.getAuthorizedFileByDocumentId({
      tenant: req.params[0],
      documentId: req.params[1],
      auth: req.auth,
    });
    return serveAuthorizedFile(req, res, next, result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "READ_FAILED" });
  }
};
exports.listFiles = async (req, res) => {
  try {
    const tenant = req.params[0];

    const result = await fileService.listFilesForTenant({
      tenant,
      folder: req.query.folder,
      visibility: req.query.visibility,
      limit: req.query.limit,
      cursor: req.query.cursor,
      tags: req.query.tag,
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error(err);

    return res.status(err.status || 500).json({
      error: err.code || "LIST_FILES_FAILED",
      message: err.message || "Failed to list files",
    });
  }
};
exports.deleteFile = async (req, res) => {
  try {
    const tenant = req.params[0];
    const id = req.params[1];

    await fileService.softDeleteFile({
      tenant,
      id,
      auth: req.auth,
    });

    return res.status(204).send();
  } catch (err) {
    console.error(err);

    return res.status(err.status || 500).json({
      error: err.code || "DELETE_FILE_FAILED",
      message: err.message || "Failed to delete file",
    });
  }
};
exports.purgeDeletedFiles = async (req, res) => {
  try {
    const tenant = req.params[0];

    const result = await fileService.purgeDeletedFiles({
      tenant,
      limit: req.query.limit,
      olderThanHours: req.query.olderThanHours,
      auth: req.auth,
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error(err);

    return res.status(err.status || 500).json({
      error: err.code || "PURGE_FILES_FAILED",
      message: err.message || "Failed to purge deleted files",
    });
  }
};
exports.restoreDeletedFile = async (req, res) => {
  try {
    const tenant = req.params[0];
    const id = req.params[1];

    const result = await fileService.restoreDeletedFile({
      tenant,
      id,
      auth: req.auth,
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error(err);

    return res.status(err.status || 500).json({
      error: err.code || "RESTORE_FILE_FAILED",
      message: err.message || "Failed to restore file",
    });
  }
};
