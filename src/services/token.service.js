const { getAuthConfig } = require("../config/auth");

async function issueServiceToken(client, config = getAuthConfig()) {
  const { SignJWT } = await import("jose");
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + config.ttlSeconds;
  const key = new TextEncoder().encode(config.signingSecret);

  const accessToken = await new SignJWT({
    token_type: "service",
    client_id: client.clientId,
    tenants: client.tenants,
    permissions: client.permissions,
    ver: client.tokenVersion,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(client.clientId)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .sign(key);

  return {
    accessToken,
    tokenType: "Bearer",
    expiresIn: config.ttlSeconds,
  };
}

module.exports = {
  issueServiceToken,
};
