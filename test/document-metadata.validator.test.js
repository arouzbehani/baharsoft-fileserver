const assert = require("node:assert/strict");
const test = require("node:test");

const {
  parseDocumentMetadata,
  parseTagFilters,
} = require("../src/validators/document-metadata.validator");

test("metadata remains optional for existing API clients", () => {
  assert.deepEqual(parseDocumentMetadata(undefined), {
    provided: false,
    tags: [],
  });
});

test("metadata rejects project-specific business fields", () => {
  assert.throws(
    () => parseDocumentMetadata('{"caseId":"case-123"}'),
    { code: "INVALID_DOCUMENT_METADATA" },
  );
});

test("metadata removes duplicate tags and validates filters", () => {
  const metadata = parseDocumentMetadata({
    tags: [
      { key: "origin", value: "translation" },
      { key: "origin", value: "translation" },
    ],
  });
  assert.deepEqual(metadata.tags, [
    { key: "origin", value: "translation" },
  ]);
  assert.deepEqual(parseTagFilters(["documentType:passport", "origin:original"]), [
    { key: "documentType", value: "passport" },
    { key: "origin", value: "original" },
  ]);
  assert.throws(() => parseTagFilters("passport"), {
    code: "INVALID_TAG_FILTER",
  });
});
