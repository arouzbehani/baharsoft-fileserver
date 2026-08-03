const crypto = require("node:crypto");
const { promisify } = require("node:util");

const {
  createServiceClient,
  getServiceClientByClientId,
  listServiceClients,
  rotateServiceClientSecret,
  setServiceClientActive,
  updateServiceClientGrants,
} = require("../repositories/service-client.repository");
const { normalizeTenant } = require("../utils/storage-paths");

const scrypt = promisify(crypto.scrypt);
const CLIENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;
const ALLOWED_PERMISSIONS = new Set([
  "upload",
  "read",
  "delete",
  "restore",
  "purge",
]);
const DUMMY_SALT = "fileserver-invalid-client";
const DUMMY_HASH = Buffer.alloc(64);

function clientError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeClientId(value) {
  const clientId = String(value || "").trim();
  if (!CLIENT_ID_PATTERN.test(clientId)) {
    throw clientError(
      "INVALID_CLIENT_ID",
      "Client ID must contain 3-128 letters, numbers, dots, underscores, or hyphens",
    );
  }
  return clientId;
}

function normalizeDisplayName(value, clientId) {
  const displayName = String(value || clientId).trim();
  if (!displayName || displayName.length > 128) {
    throw clientError("INVALID_DISPLAY_NAME", "Display name is invalid");
  }
  return displayName;
}

function normalizeTenants(values) {
  const list = Array.isArray(values) ? values : String(values || "").split(",");
  const tenants = list.filter((value) => String(value).trim()).map(normalizeTenant);
  if (!tenants.length) {
    throw clientError("TENANT_REQUIRED", "At least one tenant is required");
  }
  return [...new Set(tenants)];
}

function normalizePermissions(values) {
  const list = Array.isArray(values) ? values : String(values || "").split(",");
  const permissions = list.map((value) => String(value).trim()).filter(Boolean);
  if (!permissions.length || permissions.some((value) => !ALLOWED_PERMISSIONS.has(value))) {
    throw clientError(
      "INVALID_PERMISSION",
      "Permissions must use upload, read, delete, restore, or purge",
    );
  }
  return [...new Set(permissions)];
}

function generateClientSecret() {
  return `fs_${crypto.randomBytes(32).toString("base64url")}`;
}

async function hashClientSecret(secret, salt = crypto.randomBytes(16).toString("base64url")) {
  const hash = await scrypt(secret, salt, 64);
  return {
    salt,
    hash: Buffer.from(hash).toString("base64url"),
  };
}

function publicClient(client) {
  return {
    clientId: client.clientId,
    displayName: client.displayName,
    active: client.active,
    tokenVersion: client.tokenVersion,
    tenants: client.tenants,
    permissions: client.permissions,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
  };
}

async function provisionClient({ clientId, displayName, tenants, permissions }) {
  const normalizedClientId = normalizeClientId(clientId);
  const secret = generateClientSecret();
  const secretData = await hashClientSecret(secret);

  try {
    const client = await createServiceClient({
      clientId: normalizedClientId,
      displayName: normalizeDisplayName(displayName, normalizedClientId),
      secretSalt: secretData.salt,
      secretHash: secretData.hash,
      tenants: normalizeTenants(tenants),
      permissions: normalizePermissions(permissions),
      createdAt: new Date().toISOString(),
    });
    return { client: publicClient(client), clientSecret: secret };
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT") {
      throw clientError("CLIENT_ALREADY_EXISTS", "Service client already exists", 409);
    }
    throw error;
  }
}

async function authenticateClient(clientIdInput, secretInput) {
  let clientId;
  try {
    clientId = normalizeClientId(clientIdInput);
  } catch {
    clientId = null;
  }
  const secret = String(secretInput || "");
  const client = clientId ? await getServiceClientByClientId(clientId) : null;
  const salt = client?.secretSalt || DUMMY_SALT;
  const expected = client
    ? Buffer.from(client.secretHash, "base64url")
    : DUMMY_HASH;
  const actual = Buffer.from(await scrypt(secret, salt, 64));
  const valid =
    expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (!client || !client.active || !valid) {
    throw clientError("INVALID_CLIENT", "Invalid client credentials", 401);
  }
  return client;
}

async function rotateClient(clientIdInput) {
  const clientId = normalizeClientId(clientIdInput);
  const existing = await getServiceClientByClientId(clientId);
  if (!existing) throw clientError("CLIENT_NOT_FOUND", "Service client not found", 404);

  const secret = generateClientSecret();
  const secretData = await hashClientSecret(secret);
  await rotateServiceClientSecret({
    clientId,
    secretSalt: secretData.salt,
    secretHash: secretData.hash,
    updatedAt: new Date().toISOString(),
  });
  const client = await getServiceClientByClientId(clientId);
  return { client: publicClient(client), clientSecret: secret };
}

async function setClientActive(clientIdInput, active) {
  const clientId = normalizeClientId(clientIdInput);
  const existing = await getServiceClientByClientId(clientId);
  if (!existing) throw clientError("CLIENT_NOT_FOUND", "Service client not found", 404);
  await setServiceClientActive({
    clientId,
    active,
    updatedAt: new Date().toISOString(),
  });
  return publicClient(await getServiceClientByClientId(clientId));
}

async function updateClient({ clientId: clientIdInput, displayName, tenants, permissions }) {
  const clientId = normalizeClientId(clientIdInput);
  const existing = await getServiceClientByClientId(clientId);
  if (!existing) throw clientError("CLIENT_NOT_FOUND", "Service client not found", 404);

  const updated = await updateServiceClientGrants({
    clientId,
    displayName: normalizeDisplayName(displayName, existing.displayName),
    tenants: normalizeTenants(tenants),
    permissions: normalizePermissions(permissions),
    updatedAt: new Date().toISOString(),
  });
  return publicClient(updated);
}

async function getPublicClients() {
  return (await listServiceClients()).map(publicClient);
}

module.exports = {
  authenticateClient,
  getPublicClients,
  normalizeClientId,
  provisionClient,
  rotateClient,
  setClientActive,
  updateClient,
};
