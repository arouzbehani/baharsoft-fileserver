const { extractBearerToken, verifyToken } = require("./auth.utils");

async function requireAuth(req, res, next) {
  try {
    const token = extractBearerToken(req);

    if (!token) {
      return res.status(401).json({ error: "MISSING_TOKEN" });
    }

    const payload = await verifyToken(token);
    req.auth = payload;

    return next();
  } catch (err) {
    return res.status(401).json({ error: "INVALID_TOKEN" });
  }
}

module.exports = requireAuth;
