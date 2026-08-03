const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  ensureSafeDirectory,
  isSafeRegularFile,
  publishExclusive,
  publishOverwrite,
} = require("../src/services/file-storage.service");

async function createWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "file-storage-test-"));
  const target = path.join(root, "tenant", "documents");
  await ensureSafeDirectory(root, target);
  return { root, target };
}

test("exclusive publication never replaces an existing file", async (t) => {
  const { root, target } = await createWorkspace();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const source = path.join(root, "quarantine.upload");
  const destination = path.join(target, "passport.txt");
  await fs.writeFile(source, "new-content");
  await fs.writeFile(destination, "original-content");

  await assert.rejects(() => publishExclusive(source, destination), {
    code: "EEXIST",
  });
  assert.equal(await fs.readFile(destination, "utf8"), "original-content");
});

test("overwrite publication restores the original file when rolled back", async (t) => {
  const { root, target } = await createWorkspace();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const source = path.join(root, "quarantine.upload");
  const destination = path.join(target, "passport.txt");
  await fs.writeFile(source, "new-content");
  await fs.writeFile(destination, "original-content");

  const publication = await publishOverwrite(source, destination);
  assert.equal(await fs.readFile(destination, "utf8"), "new-content");

  await publication.rollback();
  assert.equal(await fs.readFile(destination, "utf8"), "original-content");
});

test("overwrite publication removes temporary artifacts when committed", async (t) => {
  const { root, target } = await createWorkspace();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const source = path.join(root, "quarantine.upload");
  const destination = path.join(target, "passport.txt");
  await fs.writeFile(source, "new-content");
  await fs.writeFile(destination, "original-content");

  const publication = await publishOverwrite(source, destination);
  await publication.commit();

  assert.equal(await fs.readFile(destination, "utf8"), "new-content");
  await assert.rejects(() => fs.stat(source), { code: "ENOENT" });
  assert.deepEqual(await fs.readdir(target), ["passport.txt"]);
});

test("overwrite refuses non-file destinations", async (t) => {
  const { root, target } = await createWorkspace();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const source = path.join(root, "quarantine.upload");
  const destination = path.join(target, "passport.txt");
  await fs.writeFile(source, "new-content");
  await fs.mkdir(destination);

  await assert.rejects(() => publishOverwrite(source, destination), {
    code: "FORBIDDEN_PATH",
  });
  assert.equal((await fs.lstat(destination)).isDirectory(), true);
});

test("symbolic-link directories are never treated as safe file storage", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "file-symlink-test-"));
  const tenantRoot = path.join(root, "tenant");
  const externalRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "file-symlink-external-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  t.after(() => fs.rm(externalRoot, { recursive: true, force: true }));
  await fs.mkdir(tenantRoot);
  await fs.writeFile(path.join(externalRoot, "outside.txt"), "outside");

  try {
    await fs.symlink(externalRoot, path.join(tenantRoot, "linked"), "junction");
  } catch (error) {
    if (error.code === "EPERM") {
      t.skip("Creating symbolic links is not permitted on this machine.");
      return;
    }
    throw error;
  }

  assert.equal(
    await isSafeRegularFile(
      tenantRoot,
      path.join(tenantRoot, "linked", "outside.txt"),
    ),
    false,
  );
});
