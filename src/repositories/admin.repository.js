const { get, getDb, run, withTransaction } = require("../db/sqlite");

async function countAdmins(db = getDb()) {
  const row = await get(db, "SELECT COUNT(*) AS count FROM admin_users");
  return row.count;
}

async function createFirstAdmin({ username, passwordSalt, passwordHash, createdAt }) {
  return withTransaction(async (db) => {
    if (await countAdmins(db)) return null;
    const result = await run(
      db,
      `INSERT INTO admin_users (username, password_salt, password_hash, created_at)
       VALUES (?, ?, ?, ?)`,
      [username, passwordSalt, passwordHash, createdAt],
    );
    return get(db, "SELECT * FROM admin_users WHERE id = ?", [result.lastID]);
  });
}

function findAdminByUsername(username) {
  return get(getDb(), "SELECT * FROM admin_users WHERE username = ? COLLATE NOCASE", [
    username,
  ]);
}

async function createSession({ adminUserId, tokenHash, csrfToken, createdAt, expiresAt }) {
  const db = getDb();
  await run(db, "DELETE FROM admin_sessions WHERE expires_at <= ?", [createdAt]);
  await run(
    db,
    `INSERT INTO admin_sessions
      (admin_user_id, token_hash, csrf_token, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [adminUserId, tokenHash, csrfToken, createdAt, expiresAt],
  );
  return getSessionByTokenHash(tokenHash);
}

function getSessionByTokenHash(tokenHash) {
  return get(
    getDb(),
    `SELECT s.id, s.token_hash, s.csrf_token, s.expires_at,
            u.id AS admin_user_id, u.username
     FROM admin_sessions s
     JOIN admin_users u ON u.id = s.admin_user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
    [tokenHash, new Date().toISOString()],
  );
}

function deleteSessionByTokenHash(tokenHash) {
  return run(getDb(), "DELETE FROM admin_sessions WHERE token_hash = ?", [tokenHash]);
}

function markAdminLogin(adminUserId, at) {
  return run(getDb(), "UPDATE admin_users SET last_login_at = ? WHERE id = ?", [
    at,
    adminUserId,
  ]);
}

module.exports = {
  countAdmins,
  createFirstAdmin,
  createSession,
  deleteSessionByTokenHash,
  findAdminByUsername,
  getSessionByTokenHash,
  markAdminLogin,
};
