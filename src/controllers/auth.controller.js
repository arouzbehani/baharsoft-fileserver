const {
  authenticateClient,
} = require("../services/service-client.service");
const { issueServiceToken } = require("../services/token.service");

function extractCredentials(req) {
  const header = req.headers.authorization;
  if (typeof header === "string" && /^Basic\s+/i.test(header)) {
    try {
      const decoded = Buffer.from(header.replace(/^Basic\s+/i, ""), "base64").toString(
        "utf8",
      );
      const separator = decoded.indexOf(":");
      if (separator > 0) {
        return {
          clientId: decoded.slice(0, separator),
          clientSecret: decoded.slice(separator + 1),
        };
      }
    } catch {}
  }

  return {
    clientId: req.body?.client_id,
    clientSecret: req.body?.client_secret,
  };
}

exports.issueToken = async (req, res) => {
  try {
    if (req.body?.grant_type !== "client_credentials") {
      return res.status(400).json({ error: "UNSUPPORTED_GRANT_TYPE" });
    }

    const credentials = extractCredentials(req);
    const client = await authenticateClient(
      credentials.clientId,
      credentials.clientSecret,
    );
    const token = await issueServiceToken(client);

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    return res.status(200).json({
      access_token: token.accessToken,
      token_type: token.tokenType,
      expires_in: token.expiresIn,
    });
  } catch (error) {
    if (error.code === "INVALID_CLIENT") {
      res.setHeader("WWW-Authenticate", 'Basic realm="fileserver-token"');
      return res.status(401).json({ error: "INVALID_CLIENT" });
    }
    throw error;
  }
};
