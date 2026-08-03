const path = require("path");
const crypto = require("node:crypto");

const {
  getByTenantAndRelativePath,
  getAnyByTenantAndRelativePath,
  saveFileMetadata,
  getActiveByTenantAndIdentifier,
  softDeleteByTenantAndIdentifier,
  listFiles,
  listPurgeCandidates,
  markPurgedById,
  getDeletedByTenantAndIdentifier,
  restoreByTenantAndIdentifier,
} = require("../repositories/file.repository");

const { STORAGE_ROOT } = require("../config/storage");
const { validateUploadedFile } = require("./file-validation.service");
const {
  parseDocumentMetadata,
  parseTagFilters,
} = require("../validators/document-metadata.validator");
const {
  deleteIfPresent,
  ensureSafeDirectory,
  isSafeDeletionTarget,
  isSafeRegularFile,
  publishExclusive,
  publishOverwrite,
} = require("./file-storage.service");
const {
  buildFilePath,
  buildTenantRoot,
  normalizeFilename,
  normalizeFolder: normalizeStorageFolder,
  normalizeRelativePath,
  normalizeTenant,
  resolveWithin,
} = require("../utils/storage-paths");
const DEFAULT_PURGE_RETENTION_HOURS = 7 * 24; // 7 days
function normalizeSlashes(value) {
  return String(value || "").replace(/\\/g, "/");
}

function trimLeadingSlashes(value) {
  return normalizeSlashes(value).replace(/^\/+/, "");
}

function buildRelativePath(folder, filename) {
  return trimLeadingSlashes(
    path.posix.join(normalizeSlashes(folder), filename),
  );
}

function parseVisibility(value) {
  if (!value) return "private";
  const v = String(value).toLowerCase();
  return v === "public" ? "public" : "private";
}

function parseOverwrite(value) {
  if (value == null || value === "") return false;

  const normalized = String(value).trim().toLowerCase();

  if (normalized !== "true" && normalized !== "false") {
    const error = new Error("Overwrite must be true or false");
    error.status = 400;
    error.code = "INVALID_OVERWRITE";
    throw error;
  }

  return normalized === "true";
}

function hasTenantAccess(auth, tenant) {
  const tenants = Array.isArray(auth?.tenants) ? auth.tenants : [];
  return tenants.includes(tenant);
}

function hasPermission(auth, permission) {
  const permissions = Array.isArray(auth?.permissions) ? auth.permissions : [];
  return permissions.includes(permission);
}

function buildDiskPath(tenant, relativePath) {
  try {
    return buildFilePath(STORAGE_ROOT, tenant, relativePath);
  } catch {
    return null;
  }
}

function buildCopyName(fileName, copyNumber) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);

  return copyNumber === 1
    ? `copy_${fileName}`
    : `copy_${copyNumber}_${base}${ext}`;
}
function normalizeOlderThanHours(value) {
  if (value == null || value === "") {
    return DEFAULT_PURGE_RETENTION_HOURS;
  }

  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    const err = new Error("Invalid olderThanHours");
    err.status = 400;
    err.code = "INVALID_OLDER_THAN_HOURS";
    throw err;
  }

  return parsed;
}
function normalizeVisibility(value) {
  if (!value) return null;

  const normalized = String(value).trim().toLowerCase();

  if (normalized !== "public" && normalized !== "private") {
    const err = new Error("Invalid visibility");
    err.status = 400;
    err.code = "INVALID_VISIBILITY";
    throw err;
  }

  return normalized;
}

function normalizeLimit(value) {
  if (value == null || value === "") return 20;

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    const err = new Error("Invalid limit");
    err.status = 400;
    err.code = "INVALID_LIMIT";
    throw err;
  }

  return Math.min(parsed, 100);
}
function normalizeFileIdentifier(value) {
  const text = String(value || "").trim();
  if (/^[1-9]\d*$/.test(text)) {
    const numericId = Number(text);
    if (Number.isSafeInteger(numericId)) return numericId;
  }

  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      text,
    )
  ) {
    return text.toLowerCase();
  }

  {
    const err = new Error("Invalid document id");
    err.status = 400;
    err.code = "INVALID_FILE_ID";
    throw err;
  }
}
function encodeCursor({ uploadedAt, id }) {
  return Buffer.from(`${uploadedAt}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(value) {
  try {
    const raw = Buffer.from(String(value), "base64url").toString("utf8");
    const [uploadedAt, id] = raw.split("|");

    if (!uploadedAt || !id) {
      throw new Error("Invalid cursor");
    }

    const parsedId = Number.parseInt(id, 10);

    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      throw new Error("Invalid cursor");
    }

    return {
      uploadedAt,
      id: parsedId,
    };
  } catch {
    const err = new Error("Invalid cursor");
    err.status = 400;
    err.code = "INVALID_CURSOR";
    throw err;
  }
}
function toListItem(file) {
  return {
    id: file.id,
    documentId: file.publicId,
    tenant: file.tenant,
    folder: file.folder,
    originalName: file.originalName,
    visibility: file.visibility,
    mimeType: file.mimeType,
    size: file.size,
    uploadedAt: file.uploadedAt,
    uploadedBy: file.uploadedBy,
    checksumSha256: file.checksumSha256,
    status: file.status,
    tags: file.tags,
    url: `/files/document/${file.tenant}/${file.publicId}`,
  };
}
async function listFilesForTenant({
  tenant,
  folder,
  visibility,
  limit,
  cursor,
  tags,
}) {
  if (!tenant) {
    const err = new Error("Tenant is required");
    err.status = 400;
    err.code = "TENANT_REQUIRED";
    throw err;
  }

  const normalizedTenant = normalizeTenant(tenant);
  const normalizedFolder = normalizeStorageFolder(folder);
  const normalizedVisibility = normalizeVisibility(visibility);
  const normalizedLimit = normalizeLimit(limit);
  const decodedCursor = cursor ? decodeCursor(cursor) : null;
  const normalizedTags = parseTagFilters(tags);

  const rows = await listFiles({
    tenant: normalizedTenant,
    folder: normalizedFolder,
    visibility: normalizedVisibility,
    tags: normalizedTags,
    limit: normalizedLimit,
    cursor: decodedCursor,
  });

  const hasMore = rows.length > normalizedLimit;
  const pageRows = hasMore ? rows.slice(0, normalizedLimit) : rows;
  const items = pageRows.map(toListItem);

  const nextCursor = hasMore
    ? encodeCursor({
        uploadedAt: pageRows[pageRows.length - 1].uploadedAt,
        id: pageRows[pageRows.length - 1].id,
      })
    : null;

  return {
    items,
    page: {
      limit: normalizedLimit,
      hasMore,
      nextCursor,
    },
  };
}
async function softDeleteFile({ tenant, id, auth }) {
  if (!tenant) {
    const err = new Error("Tenant is required");
    err.status = 400;
    err.code = "TENANT_REQUIRED";
    throw err;
  }

  const normalizedTenant = normalizeTenant(tenant);
  const fileIdentifier = normalizeFileIdentifier(id);

  if (!auth) {
    const err = new Error("Authentication required");
    err.status = 401;
    err.code = "AUTH_REQUIRED";
    throw err;
  }

  if (!hasTenantAccess(auth, normalizedTenant)) {
    const err = new Error("Tenant access denied");
    err.status = 403;
    err.code = "TENANT_ACCESS_DENIED";
    throw err;
  }

  if (!hasPermission(auth, "delete")) {
    const err = new Error("Insufficient permission");
    err.status = 403;
    err.code = "INSUFFICIENT_PERMISSION";
    throw err;
  }

  const existing = await getActiveByTenantAndIdentifier(
    normalizedTenant,
    fileIdentifier,
  );

  if (!existing) {
    const err = new Error("File not found");
    err.status = 404;
    err.code = "FILE_NOT_FOUND";
    throw err;
  }

  const deletedAt = new Date().toISOString();
  const result = await softDeleteByTenantAndIdentifier(
    normalizedTenant,
    fileIdentifier,
    deletedAt,
  );

  if (!result.changes) {
    const err = new Error("File not found");
    err.status = 404;
    err.code = "FILE_NOT_FOUND";
    throw err;
  }

  return {
    id: existing.id,
    documentId: existing.publicId,
    tenant: normalizedTenant,
    deletedAt,
  };
}

async function purgeDeletedFiles({ tenant, limit, olderThanHours, auth }) {
  if (!tenant) {
    const err = new Error("Tenant is required");
    err.status = 400;
    err.code = "TENANT_REQUIRED";
    throw err;
  }

  const normalizedTenant = normalizeTenant(tenant);

  if (!auth) {
    const err = new Error("Authentication required");
    err.status = 401;
    err.code = "AUTH_REQUIRED";
    throw err;
  }

  if (!hasTenantAccess(auth, normalizedTenant)) {
    const err = new Error("Tenant access denied");
    err.status = 403;
    err.code = "TENANT_ACCESS_DENIED";
    throw err;
  }

  if (!hasPermission(auth, "purge")) {
    const err = new Error("Insufficient permission");
    err.status = 403;
    err.code = "INSUFFICIENT_PERMISSION";
    throw err;
  }
  function normalizePurgeLimit(value) {
    if (value == null || value === "") return 50;

    const parsed = Number.parseInt(value, 10);

    if (!Number.isInteger(parsed) || parsed <= 0) {
      const err = new Error("Invalid limit");
      err.status = 400;
      err.code = "INVALID_LIMIT";
      throw err;
    }

    return Math.min(parsed, 200);
  }
  const normalizedLimit = normalizePurgeLimit(limit);
  const normalizedOlderThanHours = normalizeOlderThanHours(olderThanHours);
  const deletedBefore = new Date(
    Date.now() - normalizedOlderThanHours * 60 * 60 * 1000,
  ).toISOString();
  const candidates = await listPurgeCandidates({
    tenant: normalizedTenant,
    limit: normalizedLimit,
    deletedBefore,
  });

  const purged = [];
  const failed = [];

  for (const file of candidates) {
    const diskPath = buildDiskPath(file.tenant, file.relativePath);

    if (!diskPath) {
      failed.push({
        id: file.id,
        relativePath: file.relativePath,
        error: "FORBIDDEN_PATH",
      });
      continue;
    }

    try {
      const tenantRoot = buildTenantRoot(STORAGE_ROOT, file.tenant);

      if (!(await isSafeDeletionTarget(tenantRoot, diskPath))) {
        failed.push({
          id: file.id,
          relativePath: file.relativePath,
          error: "FORBIDDEN_PATH",
        });
        continue;
      }

      await deleteIfPresent(diskPath);

      const purgedAt = new Date().toISOString();
      const result = await markPurgedById(file.id, purgedAt);

      if (result.changes) {
        purged.push({
          id: file.id,
          relativePath: file.relativePath,
          purgedAt,
        });
      }
    } catch (err) {
      failed.push({
        id: file.id,
        relativePath: file.relativePath,
        error: err.code || "PURGE_FAILED",
      });
    }
  }

  return {
    tenant: normalizedTenant,
    requestedLimit: normalizedLimit,
    olderThanHours: normalizedOlderThanHours,
    deletedBefore,
    scanned: candidates.length,
    purgedCount: purged.length,
    failedCount: failed.length,
    purged,
    failed,
  };
}

async function purgeDeletedFile({ tenant, id, auth }) {
  const normalizedTenant = normalizeTenant(tenant);
  const fileIdentifier = normalizeFileIdentifier(id);

  if (!auth) {
    const err = new Error("Authentication required");
    err.status = 401;
    err.code = "AUTH_REQUIRED";
    throw err;
  }
  if (!hasTenantAccess(auth, normalizedTenant)) {
    const err = new Error("Tenant access denied");
    err.status = 403;
    err.code = "TENANT_ACCESS_DENIED";
    throw err;
  }
  if (!hasPermission(auth, "purge")) {
    const err = new Error("Insufficient permission");
    err.status = 403;
    err.code = "INSUFFICIENT_PERMISSION";
    throw err;
  }

  const existing = await getDeletedByTenantAndIdentifier(
    normalizedTenant,
    fileIdentifier,
  );
  if (!existing) {
    const err = new Error("Deleted file not found");
    err.status = 404;
    err.code = "FILE_NOT_FOUND";
    throw err;
  }
  if (existing.purgedAt) {
    const err = new Error("File already purged");
    err.status = 409;
    err.code = "FILE_ALREADY_PURGED";
    throw err;
  }

  const diskPath = buildDiskPath(normalizedTenant, existing.relativePath);
  const tenantRoot = buildTenantRoot(STORAGE_ROOT, normalizedTenant);
  if (!diskPath || !(await isSafeDeletionTarget(tenantRoot, diskPath))) {
    const err = new Error("File cannot be safely purged");
    err.status = 403;
    err.code = "FORBIDDEN_PATH";
    throw err;
  }

  await deleteIfPresent(diskPath);
  const purgedAt = new Date().toISOString();
  const result = await markPurgedById(existing.id, purgedAt);
  if (!result.changes) {
    const err = new Error("File could not be purged");
    err.status = 409;
    err.code = "PURGE_FAILED";
    throw err;
  }
  return {
    id: existing.id,
    documentId: existing.publicId,
    tenant: normalizedTenant,
    purged: true,
    purgedAt,
  };
}
async function restoreDeletedFile({ tenant, id, auth }) {
  if (!tenant) {
    const err = new Error("Tenant is required");
    err.status = 400;
    err.code = "TENANT_REQUIRED";
    throw err;
  }

  const normalizedTenant = normalizeTenant(tenant);
  const fileIdentifier = normalizeFileIdentifier(id);

  if (!auth) {
    const err = new Error("Authentication required");
    err.status = 401;
    err.code = "AUTH_REQUIRED";
    throw err;
  }

  if (!hasTenantAccess(auth, normalizedTenant)) {
    const err = new Error("Tenant access denied");
    err.status = 403;
    err.code = "TENANT_ACCESS_DENIED";
    throw err;
  }

  if (!hasPermission(auth, "restore")) {
    const err = new Error("Insufficient permission");
    err.status = 403;
    err.code = "INSUFFICIENT_PERMISSION";
    throw err;
  }

  const existing = await getDeletedByTenantAndIdentifier(
    normalizedTenant,
    fileIdentifier,
  );

  if (!existing) {
    const err = new Error("Deleted file not found");
    err.status = 404;
    err.code = "FILE_NOT_FOUND";
    throw err;
  }

  if (existing.purgedAt) {
    const err = new Error("File already purged");
    err.status = 409;
    err.code = "FILE_ALREADY_PURGED";
    throw err;
  }

  const diskPath = buildDiskPath(normalizedTenant, existing.relativePath);

  const tenantRoot = buildTenantRoot(STORAGE_ROOT, normalizedTenant);

  if (!diskPath || !(await isSafeRegularFile(tenantRoot, diskPath))) {
    const err = new Error("File binary not found");
    err.status = 409;
    err.code = "FILE_BINARY_NOT_FOUND";
    throw err;
  }

  const result = await restoreByTenantAndIdentifier(
    normalizedTenant,
    fileIdentifier,
  );

  if (!result.changes) {
    const err = new Error("File could not be restored");
    err.status = 409;
    err.code = "RESTORE_FAILED";
    throw err;
  }

  return {
    id: existing.id,
    documentId: existing.publicId,
    tenant: normalizedTenant,
    restored: true,
  };
}
async function handleUpload({
  tenant,
  folder,
  file,
  visibilityInput,
  auth,
  overwriteInput,
  metadataInput,
}) {
  let publication = null;

  try {
    const normalizedTenant = normalizeTenant(tenant);
    const normalizedFolder = normalizeStorageFolder(folder, { required: true });
    const visibility = parseVisibility(visibilityInput);
    const overwrite = parseOverwrite(overwriteInput);
    const documentMetadata = parseDocumentMetadata(metadataInput);
    const validation = await validateUploadedFile(file);

    if (!validation.ok) {
      const error = new Error(validation.message);
      error.status = 400;
      error.code = validation.code;
      error.details = validation;
      throw error;
    }

    const originalName = file.safeName || normalizeFilename(validation.originalName);
    const tenantRoot = buildTenantRoot(STORAGE_ROOT, normalizedTenant);
    const tenantFolderPath = resolveWithin(
      tenantRoot,
      ...normalizedFolder.split("/"),
    );

    await ensureSafeDirectory(STORAGE_ROOT, tenantFolderPath);

    for (let copyNumber = 0; copyNumber < 1000; copyNumber += 1) {
      const finalName =
        copyNumber === 0 ? originalName : buildCopyName(originalName, copyNumber);
      const relativePath = buildRelativePath(normalizedFolder, finalName);
      const existingActive = await getByTenantAndRelativePath(
        normalizedTenant,
        relativePath,
      );

      if (!overwrite && existingActive) continue;

      const existingAny = existingActive
        ? existingActive
        : await getAnyByTenantAndRelativePath(normalizedTenant, relativePath);
      const finalDiskPath = buildFilePath(
        STORAGE_ROOT,
        normalizedTenant,
        relativePath,
      );

      try {
        publication = overwrite
          ? await publishOverwrite(file.path, finalDiskPath)
          : await publishExclusive(file.path, finalDiskPath);
      } catch (error) {
        if (!overwrite && error.code === "EEXIST") continue;
        throw error;
      }

      const baseData = {
        publicId: existingAny?.publicId || crypto.randomUUID(),
        tenant: normalizedTenant,
        folder: normalizedFolder,
        originalName,
        storedName: finalName,
        relativePath,
        visibility,
        mimeType: validation.trustedMimeType,
        size: validation.size,
        uploadedAt: new Date().toISOString(),
        uploadedBy: auth?.sub || null,
        declaredMimeType: validation.declaredMimeType,
        detectedMimeType: validation.detectedMimeType,
        fileExtension: validation.extension,
        checksumSha256: validation.checksumSha256,
      };

      let saved;

      try {
        saved = await saveFileMetadata({
          file: baseData,
          replaceFileTags: documentMetadata.provided || !existingAny,
          tags: documentMetadata.provided
            ? documentMetadata.tags
            : existingAny?.tags || [],
        });
      } catch (error) {
        await publication.rollback();
        publication = null;
        throw error;
      }

      try {
        await publication.commit();
      } catch (cleanupError) {
        console.error(
          JSON.stringify({
            level: "error",
            event: "upload_cleanup_failed",
            message: cleanupError.message,
          }),
        );
      }

      publication = null;

      return {
        ...saved,
        overwrite,
        wasRenamed: finalName !== originalName,
        trustedMimeType: validation.trustedMimeType,
        declaredMimeType: validation.declaredMimeType,
        detectedMimeType: validation.detectedMimeType,
        fileExtension: validation.extension,
      };
    }

    const error = new Error("Could not allocate a safe destination filename");
    error.status = 409;
    error.code = "FILENAME_CONFLICT";
    throw error;
  } catch (error) {
    if (publication) {
      try {
        await publication.rollback();
      } catch (rollbackError) {
        console.error(
          JSON.stringify({
            level: "error",
            event: "upload_rollback_failed",
            message: rollbackError.message,
          }),
        );
      }
    } else if (file?.path) {
      try {
        await deleteIfPresent(file.path);
      } catch (cleanupError) {
        console.error(
          JSON.stringify({
            level: "error",
            event: "quarantine_cleanup_failed",
            message: cleanupError.message,
          }),
        );
      }
    }

    throw error;
  }
}

async function authorizeFileRead({ normalizedTenant, metadata, auth }) {
  if (!metadata) {
    return { ok: false, status: 404, error: "FILE_NOT_FOUND" };
  }

  if (metadata.visibility === "private") {
    if (!auth) {
      return { ok: false, status: 401, error: "AUTH_REQUIRED" };
    }

    if (!hasTenantAccess(auth, normalizedTenant)) {
      return { ok: false, status: 403, error: "TENANT_ACCESS_DENIED" };
    }

    if (!hasPermission(auth, "read")) {
      return { ok: false, status: 403, error: "INSUFFICIENT_PERMISSION" };
    }
  }

  const diskPath = buildDiskPath(normalizedTenant, metadata.relativePath);

  if (!diskPath) {
    return { ok: false, status: 403, error: "FORBIDDEN_PATH" };
  }

  const tenantRoot = buildTenantRoot(STORAGE_ROOT, normalizedTenant);

  if (!(await isSafeRegularFile(tenantRoot, diskPath))) {
    return { ok: false, status: 404, error: "FILE_BINARY_NOT_FOUND" };
  }

  return {
    ok: true,
    metadata,
    diskPath,
  };
}

async function getAuthorizedFileForRead({ tenant, relativePath, auth }) {
  let normalizedTenant;
  let cleanRelativePath;

  try {
    normalizedTenant = normalizeTenant(tenant);
    cleanRelativePath = normalizeRelativePath(relativePath);
  } catch (error) {
    return {
      ok: false,
      status: error.status || 400,
      error: error.code || "INVALID_PATH",
    };
  }

  const metadata = await getByTenantAndRelativePath(
    normalizedTenant,
    cleanRelativePath,
  );
  return authorizeFileRead({ normalizedTenant, metadata, auth });
}

async function getAuthorizedFileByDocumentId({ tenant, documentId, auth }) {
  let normalizedTenant;
  let identifier;

  try {
    normalizedTenant = normalizeTenant(tenant);
    identifier = normalizeFileIdentifier(documentId);
  } catch (error) {
    return {
      ok: false,
      status: error.status || 400,
      error: error.code || "INVALID_FILE_ID",
    };
  }

  const metadata = await getActiveByTenantAndIdentifier(
    normalizedTenant,
    identifier,
  );
  return authorizeFileRead({ normalizedTenant, metadata, auth });
}

module.exports = {
  handleUpload,
  getAuthorizedFileByDocumentId,
  getAuthorizedFileForRead,
  listFilesForTenant,
  softDeleteFile,
  purgeDeletedFiles,
  purgeDeletedFile,
  restoreDeletedFile,
};
