const path = require("node:path");

const TENANT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const FORBIDDEN_SEGMENT_CHARACTERS = /[<>:"|?*\x00-\x1f]/;
const MAX_FOLDER_LENGTH = 512;
const MAX_SEGMENT_BYTES = 240;

function inputError(code, message) {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  return error;
}

function normalizeTenant(value) {
  const tenant = String(value || "").trim();

  if (!TENANT_PATTERN.test(tenant)) {
    throw inputError(
      "INVALID_TENANT",
      "Tenant must be a 1-64 character letter, number, underscore, or hyphen identifier.",
    );
  }

  return tenant;
}

function assertSafeSegment(segment, code) {
  if (
    !segment ||
    segment === "." ||
    segment === ".." ||
    segment !== segment.trim() ||
    segment.endsWith(".") ||
    FORBIDDEN_SEGMENT_CHARACTERS.test(segment) ||
    WINDOWS_RESERVED_NAME.test(segment) ||
    Buffer.byteLength(segment, "utf8") > MAX_SEGMENT_BYTES
  ) {
    throw inputError(code, "Path contains an invalid or unsafe segment.");
  }
}

function normalizeFolder(value, { required = false } = {}) {
  const folder = String(value || "").normalize("NFC");

  if (!folder) {
    if (required) {
      throw inputError("INVALID_FOLDER", "Folder is required.");
    }
    return null;
  }

  if (
    folder.length > MAX_FOLDER_LENGTH ||
    folder.includes("\\") ||
    path.posix.isAbsolute(folder) ||
    path.win32.isAbsolute(folder) ||
    folder.startsWith("/") ||
    folder.endsWith("/")
  ) {
    throw inputError("INVALID_FOLDER", "Folder path is invalid or unsafe.");
  }

  const segments = folder.split("/");

  for (const segment of segments) {
    assertSafeSegment(segment, "INVALID_FOLDER");
  }

  return segments.join("/");
}

function normalizeFilename(value) {
  const originalName = String(value || "").normalize("NFC");

  if (
    !originalName ||
    originalName.includes("/") ||
    originalName.includes("\\") ||
    /[\x00-\x1f]/.test(originalName)
  ) {
    throw inputError("INVALID_FILENAME", "Filename is invalid or unsafe.");
  }

  const storedName = originalName
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/[. ]+$/g, "");

  assertSafeSegment(storedName, "INVALID_FILENAME");
  return storedName;
}

function normalizeRelativePath(value) {
  const relativePath = String(value || "").normalize("NFC");

  if (
    !relativePath ||
    relativePath.includes("\\") ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath)
  ) {
    throw inputError("INVALID_PATH", "File path is invalid or unsafe.");
  }

  const segments = relativePath.split("/");

  for (const segment of segments) {
    assertSafeSegment(segment, "INVALID_PATH");
  }

  return segments.join("/");
}

function resolveWithin(root, ...segments) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, ...segments);
  const relative = path.relative(resolvedRoot, resolvedTarget);

  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw inputError("FORBIDDEN_PATH", "Resolved path escapes its storage root.");
  }

  return resolvedTarget;
}

function buildTenantRoot(storageRoot, tenant) {
  return resolveWithin(storageRoot, normalizeTenant(tenant));
}

function buildFilePath(storageRoot, tenant, relativePath) {
  const tenantRoot = buildTenantRoot(storageRoot, tenant);
  const normalizedPath = normalizeRelativePath(relativePath);
  return resolveWithin(tenantRoot, ...normalizedPath.split("/"));
}

module.exports = {
  buildFilePath,
  buildTenantRoot,
  normalizeFilename,
  normalizeFolder,
  normalizeRelativePath,
  normalizeTenant,
  resolveWithin,
};
