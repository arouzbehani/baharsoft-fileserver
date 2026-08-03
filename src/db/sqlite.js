const fs = require("fs");
const path = require("path");
const crypto = require("node:crypto");
const sqlite3 = require("sqlite3").verbose();
const { DATA_ROOT, DB_PATH } = require("../config/storage");

let dbInstance = null;
const CURRENT_SCHEMA_VERSION = 1;

function openDb() {
  if (dbInstance) return dbInstance;

  fs.mkdirSync(DATA_ROOT, { recursive: true });

  dbInstance = new sqlite3.Database(DB_PATH);
  dbInstance.configure("busyTimeout", 5000);
  return dbInstance;
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({
        lastID: this.lastID,
        changes: this.changes,
      });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function ensureColumn(db, tableName, columnName, columnDefinition) {
  const columns = await all(db, `PRAGMA table_info(${tableName})`);

  const exists = columns.some((col) => col.name === columnName);
  if (exists) return;

  await run(
    db,
    `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`
  );
}

async function removeLegacyBusinessColumns(db) {
  const columns = await all(db, "PRAGMA table_info(files)");
  const names = new Set(columns.map((column) => column.name));
  const hasLegacyColumns = ["owner_type", "owner_id", "case_id"].some((name) =>
    names.has(name),
  );
  if (!hasLegacyColumns) return;

  await run(db, "PRAGMA foreign_keys = OFF");
  try {
    await run(db, "BEGIN IMMEDIATE");
    await run(db, "DROP TABLE IF EXISTS files_generic_migration");
    await run(
      db,
      `CREATE TABLE files_generic_migration (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id TEXT NOT NULL UNIQUE,
        tenant TEXT NOT NULL,
        folder TEXT NOT NULL,
        original_name TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
        mime_type TEXT,
        declared_mime_type TEXT,
        detected_mime_type TEXT,
        file_extension TEXT,
        size INTEGER NOT NULL,
        uploaded_at TEXT NOT NULL,
        uploaded_by TEXT,
        checksum_sha256 TEXT,
        deleted_at TEXT,
        purged_at TEXT,
        UNIQUE (tenant, relative_path)
      )`,
    );
    await run(
      db,
      `INSERT INTO files_generic_migration (
        id, public_id, tenant, folder, original_name, stored_name,
        relative_path, visibility, mime_type, declared_mime_type,
        detected_mime_type, file_extension, size, uploaded_at, uploaded_by,
        checksum_sha256, deleted_at, purged_at
      )
      SELECT
        id, public_id, tenant, folder, original_name, stored_name,
        relative_path, visibility, mime_type, declared_mime_type,
        detected_mime_type, file_extension, size, uploaded_at, uploaded_by,
        checksum_sha256, deleted_at, purged_at
      FROM files`,
    );
    await run(db, "DROP TABLE files");
    await run(db, "ALTER TABLE files_generic_migration RENAME TO files");
    await run(db, "COMMIT");
  } catch (error) {
    try {
      await run(db, "ROLLBACK");
    } catch {}
    throw error;
  } finally {
    await run(db, "PRAGMA foreign_keys = ON");
  }

  const violations = await all(db, "PRAGMA foreign_key_check");
  if (violations.length) {
    throw new Error("Database migration created foreign-key violations");
  }
}

async function applySchemaVersion1(db) {
  await run(db, "PRAGMA foreign_keys = ON");

  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      tenant TEXT NOT NULL,
      folder TEXT NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
      mime_type TEXT,
      size INTEGER NOT NULL,
      uploaded_at TEXT NOT NULL,
      uploaded_by TEXT,
      checksum_sha256 TEXT,
      UNIQUE (tenant, relative_path)
    )
    `
  );

  // Safe incremental migrations for existing DBs
  await ensureColumn(db, "files", "declared_mime_type", "TEXT");
  await ensureColumn(db, "files", "detected_mime_type", "TEXT");
  await ensureColumn(db, "files", "file_extension", "TEXT");
  await ensureColumn(db, "files", "deleted_at", "TEXT");
  await ensureColumn(db, "files", "purged_at", "TEXT");
  await ensureColumn(db, "files", "public_id", "TEXT");
  await ensureColumn(db, "files", "checksum_sha256", "TEXT");

  const missingPublicIds = await all(
    db,
    "SELECT id FROM files WHERE public_id IS NULL OR public_id = ''",
  );

  for (const row of missingPublicIds) {
    await run(db, "UPDATE files SET public_id = ? WHERE id = ?", [
      crypto.randomUUID(),
      row.id,
    ]);
  }

  await removeLegacyBusinessColumns(db);

  await run(
    db,
    `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_files_public_id
    ON files (public_id)
    `,
  );

  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS file_tags (
      file_id INTEGER NOT NULL,
      tag_key TEXT NOT NULL,
      tag_value TEXT NOT NULL,
      PRIMARY KEY (file_id, tag_key, tag_value),
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    )
    `,
  );

  await run(
    db,
    `
    CREATE INDEX IF NOT EXISTS idx_file_tags_key_value_file
    ON file_tags (tag_key, tag_value, file_id)
    `,
  );

  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS service_clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      secret_salt TEXT NOT NULL,
      secret_hash TEXT NOT NULL,
      token_version INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    `,
  );

  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS service_client_tenants (
      service_client_id INTEGER NOT NULL,
      tenant TEXT NOT NULL,
      PRIMARY KEY (service_client_id, tenant),
      FOREIGN KEY (service_client_id)
        REFERENCES service_clients(id) ON DELETE CASCADE
    )
    `,
  );

  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS service_client_permissions (
      service_client_id INTEGER NOT NULL,
      permission TEXT NOT NULL CHECK (
        permission IN ('upload', 'read', 'delete', 'restore', 'purge')
      ),
      PRIMARY KEY (service_client_id, permission),
      FOREIGN KEY (service_client_id)
        REFERENCES service_clients(id) ON DELETE CASCADE
    )
    `,
  );

  await run(
    db,
    `
    CREATE INDEX IF NOT EXISTS idx_service_clients_active
    ON service_clients (active, client_id)
    `,
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_login_at TEXT
    )`,
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS admin_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      csrf_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    )`,
  );
  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry
     ON admin_sessions (expires_at)`,
  );
  await run(
    db,
    `
    CREATE INDEX IF NOT EXISTS idx_files_tenant_visibility
    ON files (tenant, visibility)
    `
  );
  await run(
    db,
    `
    CREATE INDEX IF NOT EXISTS idx_files_tenant_uploaded_id
    ON files (tenant, uploaded_at DESC, id DESC)
    `
  );

  await run(
    db,
    `
    CREATE INDEX IF NOT EXISTS idx_files_tenant_folder_uploaded_id
    ON files (tenant, folder, uploaded_at DESC, id DESC)
    `
  );
  return db;
}

async function initializeDb() {
  const db = openDb();
  await run(db, "PRAGMA foreign_keys = ON");
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`,
  );

  const row = await get(
    db,
    "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
  );
  const installedVersion = row?.version || 0;
  if (installedVersion > CURRENT_SCHEMA_VERSION) {
    const error = new Error(
      `Database schema version ${installedVersion} is newer than supported version ${CURRENT_SCHEMA_VERSION}`,
    );
    error.code = "DATABASE_SCHEMA_TOO_NEW";
    throw error;
  }

  if (installedVersion < 1) {
    await applySchemaVersion1(db);
    await run(
      db,
      "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
      [1, new Date().toISOString()],
    );
  }

  return db;
}

function getDb() {
  return openDb();
}

async function withTransaction(work) {
  const db = getDb();
  await run(db, "BEGIN IMMEDIATE");

  try {
    const result = await work(db);
    await run(db, "COMMIT");
    return result;
  } catch (error) {
    try {
      await run(db, "ROLLBACK");
    } catch {}
    throw error;
  }
}

async function pingDb() {
  const db = getDb();
  const row = await get(db, "SELECT 1 AS healthy");
  return row?.healthy === 1;
}

function closeDb() {
  if (!dbInstance) return Promise.resolve();

  const db = dbInstance;
  dbInstance = null;

  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}
async function restoreFileById(id) {
  const db = getDb(); // uses the existing singleton
  return run(
    db,
    `UPDATE files
     SET deleted_at = NULL
     WHERE id = ?`,
    [id]
  );
}
module.exports = {
  CURRENT_SCHEMA_VERSION,
  initializeDb,
  getDb,
  run,
  get,
  all,
  pingDb,
  closeDb,
  withTransaction,
  restoreFileById,
};
