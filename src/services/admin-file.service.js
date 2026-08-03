const {
  listFilesForAdmin,
  listKnownTenants,
} = require("../repositories/file.repository");
const {
  parseTagFilters,
} = require("../validators/document-metadata.validator");
const {
  normalizeFolder,
  normalizeTenant,
} = require("../utils/storage-paths");

function invalid(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  throw error;
}

function normalizeLimit(value) {
  if (value == null || value === "") return 25;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    invalid("INVALID_LIMIT", "Limit must be a positive integer");
  }
  return Math.min(parsed, 100);
}

function normalizeVisibility(value) {
  if (!value || value === "all") return null;
  const normalized = String(value).toLowerCase();
  if (!["public", "private"].includes(normalized)) {
    invalid("INVALID_VISIBILITY", "Visibility must be public or private");
  }
  return normalized;
}

function normalizeStatus(value) {
  const normalized = String(value || "active").toLowerCase();
  if (!["active", "deleted", "purged", "all"].includes(normalized)) {
    invalid("INVALID_STATUS", "Status must be active, deleted, purged, or all");
  }
  return normalized;
}

function normalizeSearch(value) {
  const search = String(value || "").trim();
  if (search.length > 128) invalid("INVALID_SEARCH", "Search is too long");
  return search || null;
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const raw = Buffer.from(String(value), "base64url").toString("utf8");
    const separator = raw.lastIndexOf("|");
    const uploadedAt = raw.slice(0, separator);
    const id = Number.parseInt(raw.slice(separator + 1), 10);
    if (!uploadedAt || !Number.isInteger(id) || id <= 0) throw new Error();
    return { uploadedAt, id };
  } catch {
    invalid("INVALID_CURSOR", "Cursor is invalid");
  }
}

function encodeCursor(file) {
  return Buffer.from(`${file.uploadedAt}|${file.id}`, "utf8").toString("base64url");
}

function toAdminFile(file) {
  return {
    id: file.id,
    documentId: file.publicId,
    tenant: file.tenant,
    folder: file.folder,
    originalName: file.originalName,
    storedName: file.storedName,
    visibility: file.visibility,
    mimeType: file.mimeType,
    size: file.size,
    uploadedAt: file.uploadedAt,
    uploadedBy: file.uploadedBy,
    checksumSha256: file.checksumSha256,
    status: file.status,
    deletedAt: file.deletedAt,
    purgedAt: file.purgedAt,
    tags: file.tags,
  };
}

async function listAdminFiles(query) {
  const tenant = normalizeTenant(query.tenant);
  const limit = normalizeLimit(query.limit);
  const rows = await listFilesForAdmin({
    tenant,
    folder: normalizeFolder(query.folder),
    visibility: normalizeVisibility(query.visibility),
    status: normalizeStatus(query.status),
    search: normalizeSearch(query.search),
    tags: parseTagFilters(query.tag),
    limit,
    cursor: decodeCursor(query.cursor),
  });
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: pageRows.map(toAdminFile),
    page: {
      limit,
      hasMore,
      nextCursor: hasMore ? encodeCursor(pageRows[pageRows.length - 1]) : null,
    },
  };
}

module.exports = {
  listAdminFiles,
  listKnownTenants,
};
