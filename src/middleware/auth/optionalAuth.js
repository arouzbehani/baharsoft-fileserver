const { extractBearerToken, verifyToken } = require("./auth.utils");

async function optionalAuth(req, res, next) {
  try {
    const token = extractBearerToken(req);

    if (!token) {
      req.auth = null;
      return next();
    }

    const payload = await verifyToken(token);
    req.auth = payload;

    return next();
  } catch (err) {
    return res.status(401).json({ error: "INVALID_TOKEN" });
  }
}

module.exports = optionalAuth;
