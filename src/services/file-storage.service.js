const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const { resolveWithin } = require("../utils/storage-paths");

function forbiddenPath(message = "Storage path is unsafe.") {
  const error = new Error(message);
  error.status = 400;
  error.code = "FORBIDDEN_PATH";
  return error;
}

async function deleteIfPresent(filePath) {
  if (!filePath) return;

  try {
    await fsp.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function assertRegularNonSymlink(filePath, { allowMissing = false } = {}) {
  try {
    const stat = await fsp.lstat(filePath);

    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw forbiddenPath("Storage operations require regular, non-link files.");
    }
  } catch (error) {
    if (allowMissing && error.code === "ENOENT") return false;
    throw error;
  }

  return true;
}

async function ensureSafeDirectory(root, targetDirectory) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = resolveWithin(resolvedRoot, targetDirectory);
  const relative = path.relative(resolvedRoot, resolvedTarget);

  await fsp.mkdir(resolvedRoot, { recursive: true, mode: 0o700 });

  let current = resolvedRoot;

  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);

    try {
      await fsp.mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }

    const stat = await fsp.lstat(current);

    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw forbiddenPath("Storage directories cannot be symbolic links.");
    }
  }
}

async function isSafeRegularFile(root, filePath) {
  try {
    const resolvedRoot = path.resolve(root);
    const resolvedFile = resolveWithin(resolvedRoot, filePath);
    const relative = path.relative(resolvedRoot, resolvedFile);
    let current = resolvedRoot;

    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      const stat = await fsp.lstat(current);

      if (stat.isSymbolicLink()) return false;
    }

    const fileStat = await fsp.lstat(resolvedFile);
    return fileStat.isFile() && !fileStat.isSymbolicLink();
  } catch {
    return false;
  }
}

async function isSafeDeletionTarget(root, filePath) {
  try {
    const resolvedRoot = path.resolve(root);
    const resolvedFile = resolveWithin(resolvedRoot, filePath);
    const relative = path.relative(resolvedRoot, resolvedFile);
    const segments = relative.split(path.sep).filter(Boolean);
    let current = resolvedRoot;

    for (let index = 0; index < segments.length; index += 1) {
      current = path.join(current, segments[index]);

      try {
        const stat = await fsp.lstat(current);
        if (stat.isSymbolicLink()) return false;

        const isTarget = index === segments.length - 1;
        if (!isTarget && !stat.isDirectory()) return false;
        if (isTarget && !stat.isFile()) return false;
      } catch (error) {
        if (error.code === "ENOENT") return true;
        throw error;
      }
    }

    return true;
  } catch {
    return false;
  }
}

async function publishExclusive(sourcePath, destinationPath) {
  await assertRegularNonSymlink(sourcePath);
  await fsp.copyFile(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);

  return {
    async commit() {
      await deleteIfPresent(sourcePath);
    },
    async rollback() {
      await deleteIfPresent(destinationPath);
      await deleteIfPresent(sourcePath);
    },
  };
}

async function publishOverwrite(sourcePath, destinationPath) {
  const directory = path.dirname(destinationPath);
  const token = crypto.randomUUID();
  const baseName = path.basename(destinationPath);
  const stagedPath = path.join(directory, `.${baseName}.${token}.pending`);
  const backupPath = path.join(directory, `.${baseName}.${token}.backup`);
  let hasBackup = false;

  await assertRegularNonSymlink(sourcePath);
  await assertRegularNonSymlink(destinationPath, { allowMissing: true });
  await fsp.copyFile(sourcePath, stagedPath, fs.constants.COPYFILE_EXCL);

  try {
    try {
      await fsp.rename(destinationPath, backupPath);
      hasBackup = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    await fsp.rename(stagedPath, destinationPath);
  } catch (error) {
    await deleteIfPresent(stagedPath);

    if (hasBackup) {
      await fsp.rename(backupPath, destinationPath);
    }

    throw error;
  }

  return {
    async commit() {
      await deleteIfPresent(backupPath);
      await deleteIfPresent(sourcePath);
    },
    async rollback() {
      await deleteIfPresent(destinationPath);

      if (hasBackup) {
        await fsp.rename(backupPath, destinationPath);
      }

      await deleteIfPresent(stagedPath);
      await deleteIfPresent(sourcePath);
    },
  };
}

module.exports = {
  deleteIfPresent,
  ensureSafeDirectory,
  isSafeDeletionTarget,
  isSafeRegularFile,
  publishExclusive,
  publishOverwrite,
};
