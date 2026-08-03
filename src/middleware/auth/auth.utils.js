const { getAuthConfig } = require("../../config/auth");
const {
  getServiceClientByClientId,
} = require("../../repositories/service-client.repository");

const TENANT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const FILE_PERMISSIONS = new Set([
  "upload",
  "read",
  "delete",
  "restore",
  "purge",
]);
let defaultVerifierPromise = null;

function extractBearerToken(req) {
  const header = req.headers.authorization;
  if (!header || typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

function invalidClaim(message) {
  const error = new Error(message);
  error.code = "INVALID_TOKEN_CLAIMS";
  return error;
}

function normalizeArray(value, field, validator) {
  if (!Array.isArray(value)) throw invalidClaim(`${field} must be an array`);
  const values = [];
  for (const item of value) {
    if (typeof item !== "string" || !validator(item)) {
      throw invalidClaim(`${field} contains an invalid value`);
    }
    values.push(item);
  }
  return [...new Set(values)];
}

function normalizePrincipal(payload) {
  if (
    payload.token_type !== "service" ||
    typeof payload.sub !== "string" ||
    typeof payload.client_id !== "string" ||
    payload.sub !== payload.client_id ||
    !Number.isInteger(payload.ver) ||
    payload.ver <= 0
  ) {
    throw invalidClaim("Token is not a valid service token");
  }

  return Object.freeze({
    sub: payload.sub,
    clientId: payload.client_id,
    tokenVersion: payload.ver,
    tenants: normalizeArray(
      payload.tenants,
      "tenants",
      (tenant) => TENANT_PATTERN.test(tenant),
    ),
    permissions: normalizeArray(
      payload.permissions,
      "permissions",
      (permission) => FILE_PERMISSIONS.has(permission),
    ),
  });
}

async function createTokenVerifier(
  config,
  { lookupClient = getServiceClientByClientId } = {},
) {
  const { jwtVerify } = await import("jose");
  const key = new TextEncoder().encode(config.signingSecret);

  return async function verify(token) {
    const { payload } = await jwtVerify(token, key, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: config.algorithms,
      requiredClaims: [
        "sub",
        "iat",
        "exp",
        "client_id",
        "token_type",
        "tenants",
        "permissions",
        "ver",
      ],
      maxTokenAge: `${config.ttlSeconds}s`,
      clockTolerance: 5,
    });
    const principal = normalizePrincipal(payload);
    const client = await lookupClient(principal.clientId);

    if (
      !client ||
      !client.active ||
      client.tokenVersion !== principal.tokenVersion
    ) {
      const error = new Error("Service token has been revoked");
      error.code = "TOKEN_REVOKED";
      throw error;
    }
    return principal;
  };
}

async function verifyToken(token) {
  if (!defaultVerifierPromise) {
    defaultVerifierPromise = createTokenVerifier(getAuthConfig());
  }
  const verifier = await defaultVerifierPromise;
  return verifier(token);
}

module.exports = {
  createTokenVerifier,
  extractBearerToken,
  normalizePrincipal,
  verifyToken,
};
