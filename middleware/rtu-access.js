// Current research installation is a single RTU-01. This is intentionally
// NOT a multi-tenant authorization policy; validate organization ownership
// against rtu_devices before adding other customers/RTUs.
const ALLOWED_ROLES = new Set(['admin', 'administrator', 'operator']);
function authorizedOperator(req, res, next) {
  if (!ALLOWED_ROLES.has(String(req.user?.role || '').trim().toLowerCase())) {
    return res.status(403).json({ success: false, message: 'Akun tidak diizinkan mengendalikan RTU' });
  }
  const allowed = (process.env.SCADA_ALLOWED_RTUS || 'RTU-01').split(',').map(s => s.trim());
  if (!allowed.includes(req.params.id)) {
    return res.status(403).json({ success: false, message: 'RTU tidak diizinkan' });
  }
  next();
}
module.exports = { authorizedOperator };
