const assert = require("node:assert/strict");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sqlite3 = require("sqlite3").verbose();
const test = require("node:test");

const runtimeRoot = fsSync.mkdtempSync(
  path.join(os.tmpdir(), "sqlite-migration-"),
);
const dbPath = path.join(runtimeRoot, "data", "legacy.sqlite");
fsSync.mkdirSync(path.dirname(dbPath), { recursive: true });

process.env.NODE_ENV = "test";
process.env.FILESERVER_DATA_ROOT = path.join(runtimeRoot, "data");
process.env.FILESERVER_STORAGE_ROOT = path.join(runtimeRoot, "storage");
process.env.FILESERVER_DB_PATH = dbPath;
process.env.FILESERVER_QUARANTINE_ROOT = path.join(runtimeRoot, "quarantine");

const { all, closeDb, get, getDb, initializeDb, run } = require("../src/db/sqlite");

function createLegacyDatabase() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath);
    db.exec(
      `
      CREATE TABLE files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant TEXT NOT NULL,
        folder TEXT NOT NULL,
        original_name TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        visibility TEXT NOT NULL,
        mime_type TEXT,
        size INTEGER NOT NULL,
        uploaded_at TEXT NOT NULL,
        uploaded_by TEXT,
        owner_type TEXT,
        owner_id TEXT,
        case_id TEXT,
        UNIQUE (tenant, relative_path)
      );
      INSERT INTO files (
        tenant, folder, original_name, stored_name, relative_path,
        visibility, mime_type, size, uploaded_at, uploaded_by
      ) VALUES (
        'legacy-tenant', 'documents', 'passport.txt', 'passport.txt',
        'documents/passport.txt', 'private', 'text/plain', 8,
        '2026-01-01T00:00:00.000Z', 'legacy-user'
      );
      CREATE TABLE file_tags (
        file_id INTEGER NOT NULL,
        tag_key TEXT NOT NULL,
        tag_value TEXT NOT NULL,
        PRIMARY KEY (file_id, tag_key, tag_value),
        FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
      );
      INSERT INTO file_tags (file_id, tag_key, tag_value)
      VALUES (1, 'documentType', 'passport');
      `,
      (error) => {
        if (error) return reject(error);
        db.close((closeError) => (closeError ? reject(closeError) : resolve()));
      },
    );
  });
}

test("existing SQLite databases gain document IDs and tag storage", async () => {
  await createLegacyDatabase();
  await initializeDb();
  const db = getDb();

  const legacy = await get(
    db,
    "SELECT public_id, checksum_sha256 FROM files WHERE id = 1",
  );
  assert.match(legacy.public_id, /^[0-9a-f-]{36}$/);
  assert.equal(legacy.checksum_sha256, null);

  const fileColumns = await all(db, "PRAGMA table_info(files)");
  const fileColumnNames = fileColumns.map((column) => column.name);
  assert.equal(fileColumnNames.includes("owner_type"), false);
  assert.equal(fileColumnNames.includes("owner_id"), false);
  assert.equal(fileColumnNames.includes("case_id"), false);

  const tagColumns = await all(db, "PRAGMA table_info(file_tags)");
  assert.deepEqual(
    tagColumns.map((column) => column.name),
    ["file_id", "tag_key", "tag_value"],
  );
  const preservedTag = await get(
    db,
    "SELECT tag_key, tag_value FROM file_tags WHERE file_id = 1",
  );
  assert.deepEqual(preservedTag, {
    tag_key: "documentType",
    tag_value: "passport",
  });
  assert.deepEqual(await all(db, "PRAGMA foreign_key_check"), []);

  const clientTables = await all(
    db,
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name LIKE 'service_client%'
     ORDER BY name`,
  );
  assert.deepEqual(
    clientTables.map((table) => table.name),
    [
      "service_client_permissions",
      "service_client_tenants",
      "service_clients",
    ],
  );

  const adminTables = await all(
    db,
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name LIKE 'admin_%'
     ORDER BY name`,
  );
  assert.deepEqual(
    adminTables.map((table) => table.name),
    ["admin_sessions", "admin_users"],
  );

  const schemaVersions = await all(
    db,
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  assert.deepEqual(schemaVersions, [{ version: 1 }]);

  await run(
    db,
    "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
    [999, new Date().toISOString()],
  );
  await closeDb();
  await assert.rejects(() => initializeDb(), {
    code: "DATABASE_SCHEMA_TOO_NEW",
  });
});

test.after(async () => {
  await closeDb();
  await fs.rm(runtimeRoot, { recursive: true, force: true });
});
