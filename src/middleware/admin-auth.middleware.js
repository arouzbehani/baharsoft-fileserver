const crypto = require("node:crypto");
const { authenticateSession } = require("../services/admin-auth.service");

const COOKIE_NAME = "fileserver_admin_session";

function readCookie(req, name) {
  const header = String(req.headers.cookie || "");
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}

async function requireAdmin(req, res, next) {
  try {
    req.adminSessionToken = readCookie(req, COOKIE_NAME);
    req.adminSession = await authenticateSession(req.adminSessionToken);
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireAdminCsrf(req, res, next) {
  const supplied = String(req.get("x-admin-csrf") || "");
  const expected = String(req.adminSession?.csrf_token || "");
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (
    !supplied ||
    suppliedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    const error = new Error("Invalid administrator CSRF token");
    error.code = "ADMIN_CSRF_INVALID";
    error.status = 403;
    return next(error);
  }
  return next();
}

module.exports = {
  ADMIN_COOKIE_NAME: COOKIE_NAME,
  readCookie,
  requireAdmin,
  requireAdminCsrf,
};
