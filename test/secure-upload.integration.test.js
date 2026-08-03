const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const runtimeRoot = fsSync.mkdtempSync(
  path.join(os.tmpdir(), "secure-upload-integration-"),
);
process.env.NODE_ENV = "test";
process.env.FILESERVER_DATA_ROOT = path.join(runtimeRoot, "data");
process.env.FILESERVER_STORAGE_ROOT = path.join(runtimeRoot, "storage");
process.env.FILESERVER_DB_PATH = path.join(runtimeRoot, "data", "test.sqlite");
process.env.FILESERVER_QUARANTINE_ROOT = path.join(runtimeRoot, "quarantine");

const { closeDb, initializeDb } = require("../src/db/sqlite");
const {
  getAuthorizedFileForRead,
  handleUpload,
  listFilesForTenant,
  restoreDeletedFile,
  softDeleteFile,
} = require("../src/services/file.service");
const { normalizeFilename } = require("../src/utils/storage-paths");

test.before(async () => {
  await initializeDb();
  await fs.mkdir(process.env.FILESERVER_QUARANTINE_ROOT, { recursive: true });
});

test.after(async () => {
  await closeDb();
  await fs.rm(runtimeRoot, { recursive: true, force: true });
});

async function quarantinedFile(name, content, mimetype = "text/plain") {
  const filePath = path.join(
    process.env.FILESERVER_QUARANTINE_ROOT,
    `${Date.now()}-${Math.random()}.upload`,
  );
  await fs.writeFile(filePath, content);
  return {
    path: filePath,
    originalname: name,
    safeName: normalizeFilename(name),
    mimetype,
  };
}

function upload(file, overrides = {}) {
  return handleUpload({
    tenant: "baharsoft-demo",
    folder: "cases/identity",
    file,
    visibilityInput: "private",
    overwriteInput: undefined,
    auth: { sub: "test-user" },
    ...overrides,
  });
}

test("duplicate uploads are non-destructive by default", async () => {
  const first = await upload(await quarantinedFile("passport.txt", "original"));
  const second = await upload(await quarantinedFile("passport.txt", "second"));

  assert.equal(first.storedName, "passport.txt");
  assert.equal(second.storedName, "copy_passport.txt");
  assert.equal(second.wasRenamed, true);

  const tenantRoot = path.join(
    process.env.FILESERVER_STORAGE_ROOT,
    "baharsoft-demo",
    "cases",
    "identity",
  );
  assert.equal(await fs.readFile(path.join(tenantRoot, "passport.txt"), "utf8"), "original");
  assert.equal(await fs.readFile(path.join(tenantRoot, "copy_passport.txt"), "utf8"), "second");
});

test("overwrite requires an explicit true value", async () => {
  const saved = await upload(await quarantinedFile("passport.txt", "replacement"), {
    overwriteInput: "true",
  });
  const destination = path.join(
    process.env.FILESERVER_STORAGE_ROOT,
    "baharsoft-demo",
    "cases",
    "identity",
    "passport.txt",
  );

  assert.equal(saved.storedName, "passport.txt");
  assert.equal(saved.overwrite, true);
  assert.equal(await fs.readFile(destination, "utf8"), "replacement");
});

test("an invalid upload cannot damage an existing destination", async () => {
  const invalidFile = await quarantinedFile("passport.txt", "");
  const destination = path.join(
    process.env.FILESERVER_STORAGE_ROOT,
    "baharsoft-demo",
    "cases",
    "identity",
    "passport.txt",
  );

  await assert.rejects(() => upload(invalidFile, { overwriteInput: "true" }), {
    code: "EMPTY_FILE",
  });
  assert.equal(await fs.readFile(destination, "utf8"), "replacement");
  await assert.rejects(() => fs.stat(invalidFile.path), { code: "ENOENT" });
});

test("unsafe folders are rejected and their quarantine file is removed", async () => {
  const file = await quarantinedFile("passport.txt", "unsafe");

  await assert.rejects(
    () => upload(file, { folder: "cases/../../outside" }),
    { code: "INVALID_FOLDER" },
  );
  await assert.rejects(() => fs.stat(file.path), { code: "ENOENT" });
  await assert.rejects(
    () => fs.stat(path.join(runtimeRoot, "outside", "passport.txt")),
    { code: "ENOENT" },
  );
});

test("documents store checksums and multiple generic tags", async () => {
  const content = "passport-document";
  const saved = await upload(
    await quarantinedFile("tagged-passport.txt", content),
    {
      metadataInput: JSON.stringify({
        tags: [
          { key: "documentType", value: "passport" },
          { key: "origin", value: "translation" },
          { key: "language", value: "fa" },
        ],
      }),
    },
  );

  assert.match(saved.publicId, /^[0-9a-f-]{36}$/);
  assert.equal(
    saved.checksumSha256,
    crypto.createHash("sha256").update(content).digest("hex"),
  );
  assert.deepEqual(saved.tags, [
    { key: "documentType", value: "passport" },
    { key: "language", value: "fa" },
    { key: "origin", value: "translation" },
  ]);

  const filtered = await listFilesForTenant({
    tenant: "baharsoft-demo",
    tags: ["documentType:passport", "origin:translation"],
    limit: 20,
  });
  assert.equal(filtered.items.length, 1);
  assert.equal(filtered.items[0].documentId, saved.publicId);
  assert.equal(filtered.items[0].status, "active");
});

test("overwrite preserves tags unless replacement metadata is supplied", async () => {
  const preserved = await upload(
    await quarantinedFile("tagged-passport.txt", "new-version"),
    { overwriteInput: "true" },
  );
  assert.deepEqual(
    preserved.tags.find((tag) => tag.key === "origin"),
    { key: "origin", value: "translation" },
  );

  const replaced = await upload(
    await quarantinedFile("tagged-passport.txt", "original-version"),
    {
      overwriteInput: "true",
      metadataInput: JSON.stringify({
        tags: [
          { key: "documentType", value: "passport" },
          { key: "origin", value: "original" },
        ],
      }),
    },
  );
  assert.equal(replaced.publicId, preserved.publicId);
  assert.deepEqual(replaced.tags, [
    { key: "documentType", value: "passport" },
    { key: "origin", value: "original" },
  ]);
});

test("stable document UUID supports delete and restore", async () => {
  const saved = await upload(
    await quarantinedFile("lifecycle-document.txt", "lifecycle"),
  );
  const auth = {
    sub: "test-user",
    tenants: ["baharsoft-demo"],
    permissions: ["delete", "restore"],
  };

  const deleted = await softDeleteFile({
    tenant: "baharsoft-demo",
    id: saved.publicId,
    auth,
  });
  assert.equal(deleted.documentId, saved.publicId);

  const restored = await restoreDeletedFile({
    tenant: "baharsoft-demo",
    id: saved.publicId,
    auth,
  });
  assert.equal(restored.documentId, saved.publicId);
  assert.equal(restored.restored, true);
});

test("read resolution rejects traversal before accessing metadata or disk", async () => {
  const result = await getAuthorizedFileForRead({
    tenant: "baharsoft-demo",
    relativePath: "cases/../../outside.txt",
    auth: {
      tenants: ["baharsoft-demo"],
      permissions: ["read"],
    },
  });

  assert.deepEqual(result, {
    ok: false,
    status: 400,
    error: "INVALID_PATH",
  });
});
