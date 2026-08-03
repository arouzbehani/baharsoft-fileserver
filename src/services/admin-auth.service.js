const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { getRuntimeConfig } = require("../config/env");
const {
  countAdmins,
  createFirstAdmin,
  createSession,
  deleteSessionByTokenHash,
  findAdminByUsername,
  getSessionByTokenHash,
  markAdminLogin,
} = require("../repositories/admin.repository");

const scrypt = promisify(crypto.scrypt);
const DUMMY_SALT = "fileserver-invalid-admin";
const DUMMY_HASH = Buffer.alloc(64);

function adminError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeUsername(value) {
  const username = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(username)) {
    throw adminError(
      "INVALID_ADMIN_USERNAME",
      "Username must contain 3-64 letters, numbers, dots, underscores, or hyphens",
    );
  }
  return username;
}

function validatePassword(value) {
  const password = String(value || "");
  if (password.length < 12 || password.length > 256) {
    throw adminError(
      "INVALID_ADMIN_PASSWORD",
      "Password must contain between 12 and 256 characters",
    );
  }
  return password;
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString("base64url")) {
  const hash = await scrypt(password, salt, 64);
  return { salt, hash: Buffer.from(hash).toString("base64url") };
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("base64url");
}

function publicAdmin(row) {
  return { id: row.admin_user_id || row.id, username: row.username };
}

async function getSetupStatus() {
  const setupRequired = (await countAdmins()) === 0;
  return {
    setupRequired,
    bootstrapRequired:
      setupRequired && Boolean(getRuntimeConfig().adminBootstrapToken),
  };
}

function verifyBootstrapToken(input) {
  const expected = getRuntimeConfig().adminBootstrapToken;
  if (!expected) return;
  const supplied = String(input || "");
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    throw adminError(
      "INVALID_ADMIN_BOOTSTRAP_TOKEN",
      "Invalid administrator bootstrap token",
      403,
    );
  }
}

async function setupFirstAdmin({ username, password, bootstrapToken }) {
  if (await countAdmins()) {
    throw adminError("ADMIN_SETUP_COMPLETE", "Administrator setup is already complete", 409);
  }
  verifyBootstrapToken(bootstrapToken);
  const normalizedUsername = normalizeUsername(username);
  const credentials = await hashPassword(validatePassword(password));
  const admin = await createFirstAdmin({
    username: normalizedUsername,
    passwordSalt: credentials.salt,
    passwordHash: credentials.hash,
    createdAt: new Date().toISOString(),
  });
  if (!admin) {
    throw adminError("ADMIN_SETUP_COMPLETE", "Administrator setup is already complete", 409);
  }
  return issueSession(admin);
}

async function login({ username, password }) {
  let normalizedUsername;
  try {
    normalizedUsername = normalizeUsername(username);
  } catch {
    normalizedUsername = null;
  }
  const admin = normalizedUsername
    ? await findAdminByUsername(normalizedUsername)
    : null;
  const expected = admin
    ? Buffer.from(admin.password_hash, "base64url")
    : DUMMY_HASH;
  const actual = Buffer.from(
    await scrypt(String(password || ""), admin?.password_salt || DUMMY_SALT, 64),
  );
  const valid = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  if (!admin || !valid) {
    throw adminError("INVALID_ADMIN_CREDENTIALS", "Invalid username or password", 401);
  }
  await markAdminLogin(admin.id, new Date().toISOString());
  return issueSession(admin);
}

async function issueSession(admin) {
  const config = getRuntimeConfig();
  const token = crypto.randomBytes(32).toString("base64url");
  const csrfToken = crypto.randomBytes(24).toString("base64url");
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + config.adminSessionTtlSeconds * 1000);
  await createSession({
    adminUserId: admin.id,
    tokenHash: hashToken(token),
    csrfToken,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  return {
    admin: { id: admin.id, username: admin.username },
    token,
    csrfToken,
    expiresAt: expiresAt.toISOString(),
  };
}

async function authenticateSession(token) {
  if (!token) throw adminError("ADMIN_AUTH_REQUIRED", "Administrator login required", 401);
  const session = await getSessionByTokenHash(hashToken(token));
  if (!session) throw adminError("ADMIN_SESSION_INVALID", "Administrator session expired", 401);
  return { ...session, admin: publicAdmin(session) };
}

async function logout(token) {
  if (token) await deleteSessionByTokenHash(hashToken(token));
}

module.exports = {
  authenticateSession,
  getSetupStatus,
  login,
  logout,
  setupFirstAdmin,
};
