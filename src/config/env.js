const path = require("path");
const dotenv = require("dotenv");
const packageMetadata = require("../../package.json");

dotenv.config({ quiet: true });

const PROJECT_ROOT = path.resolve(__dirname, "../..");

function parsePort(value) {
  const port = Number.parseInt(value || "3000", 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return port;
}

function resolveConfiguredPath(value, fallback) {
  return path.resolve(value || fallback);
}

function requiredString(env, name) {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parsePositiveInteger(value, name, fallback) {
  const parsed = Number.parseInt(value == null || value === "" ? fallback : value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  if (parsed > 86400) {
    throw new Error(`${name} must not exceed 86400 seconds`);
  }
  return parsed;
}

function isSameOrWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function getRuntimeConfig(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || "development").trim().toLowerCase();
  const allowedEnvironments = new Set(["development", "test", "production"]);

  if (!allowedEnvironments.has(nodeEnv)) {
    throw new Error("NODE_ENV must be development, test, or production");
  }

  const tokenSigningSecret = requiredString(
    env,
    "FILESERVER_TOKEN_SIGNING_SECRET",
  );
  if (tokenSigningSecret.length < 32) {
    throw new Error(
      "FILESERVER_TOKEN_SIGNING_SECRET must contain at least 32 characters",
    );
  }
  const tokenIssuer = String(
    env.FILESERVER_TOKEN_ISSUER || "baharsoft-fileserver",
  ).trim();
  const tokenAudience = String(
    env.FILESERVER_TOKEN_AUDIENCE || "baharsoft-fileserver",
  ).trim();
  if (!tokenIssuer || tokenIssuer.length > 256 || /\s/.test(tokenIssuer)) {
    throw new Error("FILESERVER_TOKEN_ISSUER has an invalid format");
  }
  if (!tokenAudience || tokenAudience.length > 256 || /\s/.test(tokenAudience)) {
    throw new Error("FILESERVER_TOKEN_AUDIENCE has an invalid format");
  }
  const tokenTtlSeconds = parsePositiveInteger(
    env.FILESERVER_TOKEN_TTL_SECONDS,
    "FILESERVER_TOKEN_TTL_SECONDS",
    300,
  );
  if (tokenTtlSeconds > 3600) {
    throw new Error("FILESERVER_TOKEN_TTL_SECONDS must not exceed 3600 seconds");
  }
  const adminSessionTtlSeconds = parsePositiveInteger(
    env.FILESERVER_ADMIN_SESSION_TTL_SECONDS,
    "FILESERVER_ADMIN_SESSION_TTL_SECONDS",
    28800,
  );
  const adminBootstrapToken = String(
    env.FILESERVER_ADMIN_BOOTSTRAP_TOKEN || "",
  ).trim();
  if (adminBootstrapToken && adminBootstrapToken.length < 32) {
    throw new Error(
      "FILESERVER_ADMIN_BOOTSTRAP_TOKEN must contain at least 32 characters",
    );
  }
  const serviceVersion = String(
    env.FILESERVER_VERSION || packageMetadata.version,
  ).trim();
  if (!/^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/.test(serviceVersion)) {
    throw new Error("FILESERVER_VERSION has an invalid format");
  }
  if (nodeEnv === "production" && !adminBootstrapToken) {
    throw new Error("FILESERVER_ADMIN_BOOTSTRAP_TOKEN is required in production");
  }

  const dataRoot = resolveConfiguredPath(
    env.FILESERVER_DATA_ROOT,
    path.join(PROJECT_ROOT, "data"),
  );
  const storageRoot = resolveConfiguredPath(
    env.FILESERVER_STORAGE_ROOT,
    path.join(PROJECT_ROOT, "storage", "tenants"),
  );
  const dbPath = resolveConfiguredPath(
    env.FILESERVER_DB_PATH,
    path.join(dataRoot, "fileserver.sqlite"),
  );
  const quarantineRoot = resolveConfiguredPath(
    env.FILESERVER_QUARANTINE_ROOT,
    path.join(dataRoot, "quarantine"),
  );

  if (
    isSameOrWithin(storageRoot, quarantineRoot) ||
    isSameOrWithin(quarantineRoot, storageRoot) ||
    isSameOrWithin(storageRoot, dbPath)
  ) {
    throw new Error(
      "Storage, quarantine, and database paths must be operationally separate",
    );
  }

  return Object.freeze({
    nodeEnv,
    serviceVersion,
    port: parsePort(env.PORT),
    tokenSigningSecret,
    tokenIssuer,
    tokenAudience,
    tokenTtlSeconds,
    adminSessionTtlSeconds,
    adminBootstrapToken,
    dataRoot,
    storageRoot,
    dbPath,
    quarantineRoot,
  });
}

module.exports = {
  getRuntimeConfig,
};
