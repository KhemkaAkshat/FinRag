export function createRateLimiter({ windowMs = 60000, max = 30, now = () => Date.now() } = {}) {
  const clients = new Map();

  return (req, res, next) => {
    const key = req.ip || req.socket?.remoteAddress || "unknown";
    const current = clients.get(key);
    const timestamp = now();
    const window = current && timestamp - current.startedAt < windowMs
      ? current
      : { startedAt: timestamp, count: 0 };

    window.count += 1;
    clients.set(key, window);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - window.count)));

    if (window.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((windowMs - (timestamp - window.startedAt)) / 1000)));
      return res.status(429).json({ success: false, error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." } });
    }
    return next();
  };
}
