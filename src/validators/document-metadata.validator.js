const TAG_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const MAX_TAGS = 20;
const MAX_TAG_FILTERS = 10;
const MAX_TAG_VALUE_LENGTH = 256;

function invalid(message, details) {
  const error = new Error(message);
  error.status = 400;
  error.code = "INVALID_DOCUMENT_METADATA";
  if (details) error.details = details;
  return error;
}

function optionalString(value, field, maxLength) {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw invalid(`${field} must be a string`);
  }

  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw invalid(
      `${field} must contain between 1 and ${maxLength} characters`,
    );
  }
  return normalized;
}

function normalizeTag(tag, index) {
  if (!tag || typeof tag !== "object" || Array.isArray(tag)) {
    throw invalid(`tags[${index}] must be an object`);
  }

  const key = optionalString(tag.key, `tags[${index}].key`, 64);
  const value = optionalString(
    tag.value,
    `tags[${index}].value`,
    MAX_TAG_VALUE_LENGTH,
  );

  if (!TAG_KEY_PATTERN.test(key)) {
    throw invalid(`tags[${index}].key has an invalid format`);
  }

  return { key, value };
}

function normalizeTags(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw invalid("tags must be an array");
  if (value.length > MAX_TAGS) {
    throw invalid(`tags may contain at most ${MAX_TAGS} entries`);
  }

  const unique = new Map();
  value.forEach((tag, index) => {
    const normalized = normalizeTag(tag, index);
    unique.set(`${normalized.key}\u0000${normalized.value}`, normalized);
  });
  return [...unique.values()];
}

function parseDocumentMetadata(input) {
  if (input == null || input === "") {
    return {
      provided: false,
      tags: [],
    };
  }

  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      throw invalid("metadata must be valid JSON");
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid("metadata must be a JSON object");
  }

  const unsupportedFields = Object.keys(value).filter((key) => key !== "tags");
  if (unsupportedFields.length) {
    throw invalid(
      `metadata contains unsupported fields: ${unsupportedFields.join(", ")}`,
    );
  }

  return {
    provided: true,
    tags: normalizeTags(value.tags),
  };
}

function parseTagFilters(input) {
  if (input == null || input === "") return [];
  const values = Array.isArray(input) ? input : [input];

  if (values.length > MAX_TAG_FILTERS) {
    const error = invalid(
      `tag filters may contain at most ${MAX_TAG_FILTERS} entries`,
    );
    error.code = "INVALID_TAG_FILTER";
    throw error;
  }

  return values.map((raw, index) => {
    const text = String(raw);
    const separator = text.indexOf(":");
    if (separator <= 0 || separator === text.length - 1) {
      const error = invalid("tag filters must use the key:value format");
      error.code = "INVALID_TAG_FILTER";
      throw error;
    }

    try {
      return normalizeTag(
        { key: text.slice(0, separator), value: text.slice(separator + 1) },
        index,
      );
    } catch (error) {
      error.code = "INVALID_TAG_FILTER";
      throw error;
    }
  });
}

module.exports = {
  parseDocumentMetadata,
  parseTagFilters,
};
