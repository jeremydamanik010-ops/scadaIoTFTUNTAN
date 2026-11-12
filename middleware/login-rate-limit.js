// Small, dependency-free limiter; resets on restart. For multi-instance use Redis/edge rules.
const counts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
module.exports = function loginRateLimit(req, res, next) {
  const now = Date.now();
  if (counts.size > 2000) for (const [k, v] of counts) if (v.reset <= now) counts.delete(k);
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const key = `${ip}:${req.path}`;
  let entry = counts.get(key);
  if (!entry || entry.reset <= now) entry = { count: 0, reset: now + WINDOW_MS };
  entry.count++;
  counts.set(key, entry);
  if (entry.count > 12) {
    res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000));
    return res.status(429).json({ success: false, message: 'Terlalu banyak percobaan. Coba lagi nanti.' });
  }
  next();
};
