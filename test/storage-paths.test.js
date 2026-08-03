const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  buildFilePath,
  normalizeFilename,
  normalizeFolder,
  normalizeTenant,
  resolveWithin,
} = require("../src/utils/storage-paths");

test("normalizes safe storage identifiers without changing their meaning", () => {
  assert.equal(normalizeTenant("baharsoft-demo"), "baharsoft-demo");
  assert.equal(normalizeFolder("cases/identity"), "cases/identity");
  assert.equal(normalizeFilename("My Passport.pdf"), "My_Passport.pdf");
});

test("rejects traversal, absolute paths, and unsafe tenant identifiers", () => {
  assert.throws(() => normalizeTenant("../tenant"), { code: "INVALID_TENANT" });
  assert.throws(() => normalizeFolder("cases/../other"), {
    code: "INVALID_FOLDER",
  });
  assert.throws(() => normalizeFolder("C:\\outside"), {
    code: "INVALID_FOLDER",
  });
  assert.throws(() => normalizeFilename("../passport.pdf"), {
    code: "INVALID_FILENAME",
  });
});

test("resolves files strictly within the selected tenant root", () => {
  const root = path.resolve("runtime-storage");
  const filePath = buildFilePath(
    root,
    "baharsoft-demo",
    "cases/identity/passport.pdf",
  );

  assert.equal(
    filePath,
    path.join(
      root,
      "baharsoft-demo",
      "cases",
      "identity",
      "passport.pdf",
    ),
  );
  assert.throws(() => resolveWithin(root, "..", "outside.txt"), {
    code: "FORBIDDEN_PATH",
  });
});
