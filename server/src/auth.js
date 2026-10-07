const jwt = require('jsonwebtoken');
const db = require('./db');
exports.authenticateUser = async (req, res, next) => {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, message: 'Authentication required.' });
    const p = jwt.verify(token, process.env.JWT_SECRET);
    const [rows] = await db.query('SELECT id,email,role,full_name,account_status FROM users WHERE id=?', [p.id]);
    if (!rows[0] || rows[0].account_status !== 'ACTIVE')
      return res.status(401).json({ success: false, message: 'Account inactive or not found.' });
    req.user = rows[0];
    next();
  } catch (e) {
    res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
};
exports.authorizeRoles = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next()
    : res.status(403).json({ success: false, message: 'You are not authorized to perform this action.' });
