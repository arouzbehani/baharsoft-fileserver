const { getRuntimeConfig } = require("./env");

function getAuthConfig(env = process.env) {
  const config = getRuntimeConfig(env);

  return Object.freeze({
    signingSecret: config.tokenSigningSecret,
    issuer: config.tokenIssuer,
    audience: config.tokenAudience,
    ttlSeconds: config.tokenTtlSeconds,
    algorithms: ["HS256"],
  });
}

module.exports = {
  getAuthConfig,
};
