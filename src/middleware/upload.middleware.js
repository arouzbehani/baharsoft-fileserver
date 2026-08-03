const crypto = require("node:crypto");
const fs = require("node:fs");
const multer = require("multer");

const { QUARANTINE_ROOT } = require("../config/storage");
const { normalizeFilename } = require("../utils/storage-paths");

function decodeOriginalName(value) {
  return Buffer.from(String(value || ""), "latin1").toString("utf8");
}

const storage = multer.diskStorage({
  destination: (req, file, callback) => {
    try {
      fs.mkdirSync(QUARANTINE_ROOT, { recursive: true, mode: 0o700 });
      callback(null, QUARANTINE_ROOT);
    } catch (error) {
      callback(error);
    }
  },

  filename: (req, file, callback) => {
    try {
      const decodedName = decodeOriginalName(file.originalname);
      file.originalname = decodedName;
      file.safeName = normalizeFilename(decodedName);
      callback(null, `${crypto.randomUUID()}.upload`);
    } catch (error) {
      callback(error);
    }
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 250 * 1024 * 1024,
    files: 1,
    fields: 4,
    parts: 5,
    fieldNameSize: 100,
  },
});

module.exports = upload;
