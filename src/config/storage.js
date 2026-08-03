const path = require("path");
require("./env");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const STORAGE_ROOT = path.resolve(
  process.env.FILESERVER_STORAGE_ROOT ||
    path.join(PROJECT_ROOT, "storage", "tenants"),
);
const DATA_ROOT = path.resolve(
  process.env.FILESERVER_DATA_ROOT || path.join(PROJECT_ROOT, "data"),
);
const DB_PATH = path.resolve(
  process.env.FILESERVER_DB_PATH || path.join(DATA_ROOT, "fileserver.sqlite"),
);
const QUARANTINE_ROOT = path.resolve(
  process.env.FILESERVER_QUARANTINE_ROOT || path.join(DATA_ROOT, "quarantine"),
);

module.exports = {
  STORAGE_ROOT,
  DATA_ROOT,
  DB_PATH,
  QUARANTINE_ROOT,
};
