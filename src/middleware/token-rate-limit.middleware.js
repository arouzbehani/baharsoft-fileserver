const attempts = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_ATTEMPTS = 20;

function tokenRateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const current = attempts.get(key);
  const entry =
    !current || current.resetAt <= now
      ? { count: 0, resetAt: now + WINDOW_MS }
      : current;
  entry.count += 1;
  attempts.set(key, entry);

  if (attempts.size > 1000) {
    for (const [candidate, value] of attempts) {
      if (value.resetAt <= now) attempts.delete(candidate);
    }
  }

  res.setHeader("X-RateLimit-Limit", MAX_ATTEMPTS);
  res.setHeader("X-RateLimit-Remaining", Math.max(0, MAX_ATTEMPTS - entry.count));

  if (entry.count > MAX_ATTEMPTS) {
    res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
    return res.status(429).json({ error: "TOKEN_RATE_LIMITED" });
  }
  return next();
}

module.exports = tokenRateLimit;
