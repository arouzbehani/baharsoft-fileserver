const assert = require("node:assert/strict");
const test = require("node:test");

const { createTokenVerifier } = require("../src/middleware/auth/auth.utils");
const { issueServiceToken } = require("../src/services/token.service");

const config = {
  signingSecret: "test-only-fileserver-signing-secret-which-is-long-enough",
  issuer: "baharsoft-fileserver",
  audience: "baharsoft-fileserver",
  ttlSeconds: 300,
  algorithms: ["HS256"],
};
const client = {
  clientId: "baharsoft-demo-api",
  active: true,
  tokenVersion: 3,
  tenants: ["baharsoft-demo"],
  permissions: ["read", "upload"],
};

let verifier;

test.before(async () => {
  verifier = await createTokenVerifier(config, {
    lookupClient: async (clientId) =>
      clientId === client.clientId ? client : null,
  });
});

test("internally issued service tokens become a trusted principal", async () => {
  const issued = await issueServiceToken(client, config);
  const principal = await verifier(issued.accessToken);

  assert.deepEqual(principal, {
    sub: "baharsoft-demo-api",
    clientId: "baharsoft-demo-api",
    tokenVersion: 3,
    tenants: ["baharsoft-demo"],
    permissions: ["read", "upload"],
  });
  assert.equal(issued.tokenType, "Bearer");
  assert.equal(issued.expiresIn, 300);
});

test("wrong audience and forged service tokens are rejected", async () => {
  const wrongAudience = await issueServiceToken(client, {
    ...config,
    audience: "another-service",
  });
  await assert.rejects(() => verifier(wrongAudience.accessToken));

  const forged = await issueServiceToken(client, {
    ...config,
    signingSecret: "attacker-controlled-signing-secret-that-is-long-enough",
  });
  await assert.rejects(() => verifier(forged.accessToken));
});

test("disabled clients and rotated token versions revoke existing tokens", async () => {
  const issued = await issueServiceToken(client, config);
  const disabledVerifier = await createTokenVerifier(config, {
    lookupClient: async () => ({ ...client, active: false }),
  });
  const rotatedVerifier = await createTokenVerifier(config, {
    lookupClient: async () => ({ ...client, tokenVersion: 4 }),
  });

  await assert.rejects(() => disabledVerifier(issued.accessToken), {
    code: "TOKEN_REVOKED",
  });
  await assert.rejects(() => rotatedVerifier(issued.accessToken), {
    code: "TOKEN_REVOKED",
  });
});

test("malformed service claims are rejected after signature verification", async () => {
  const { SignJWT } = await import("jose");
  const key = new TextEncoder().encode(config.signingSecret);
  const malformed = await new SignJWT({
    token_type: "service",
    client_id: client.clientId,
    tenants: "baharsoft-demo",
    permissions: ["read"],
    ver: 3,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(client.clientId)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);

  await assert.rejects(() => verifier(malformed), {
    code: "INVALID_TOKEN_CLAIMS",
  });
});
