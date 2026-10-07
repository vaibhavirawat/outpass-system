const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const wf = require('./workflow');
const { authenticateUser, authorizeRoles } = require('./auth');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const ok = (res, data, status = 200) => res.status(status).json({ success: true, ...data });

// ---------- Auth ----------
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { success: false, message: 'Too many login attempts. Try later.' } });
router.post('/auth/login', loginLimiter, wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (!/^\S+@\S+\.\S+$/.test(email || '') || !password) throw new wf.HttpError(400, 'Valid email and password are required.');
  const [rows] = await db.query('SELECT * FROM users WHERE email=?', [email.toLowerCase()]);
  const u = rows[0];
  if (!u || u.account_status !== 'ACTIVE' || !(await bcrypt.compare(password, u.password_hash)))
    throw new wf.HttpError(401, 'Invalid credentials.');
  const token = jwt.sign({ id: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
  ok(res, { token, user: { id: u.id, email: u.email, role: u.role, full_name: u.full_name } });
}));
router.get('/auth/me', authenticateUser, wrap(async (req, res) => ok(res, { user: req.user })));
router.post('/auth/logout', authenticateUser, (req, res) => ok(res, { message: 'Logged out. Discard the token client-side.' }));

// ---------- Outpasses ----------
router.use('/outpasses', authenticateUser);

router.post('/outpasses', authorizeRoles('student'), wrap(async (req, res) =>
  ok(res, { id: await wf.create(req.user, req.body, req.ip) }, 201)));

// Role-scoped list; optional ?status=&q=
async function list(req, res) {
  const { role, id } = req.user;
  const scope = { student: 'o.student_id=?', parent: 's.parent_user_id=?',
    warden: 's.block_id=(SELECT block_id FROM wardens WHERE user_id=?)', admin: '1=1' }[role];
  const params = role === 'admin' ? [] : [id];
  let sql = `SELECT o.*, su.full_name AS student_name, s.roll_number, s.room_number, b.code AS block
             FROM outpasses o JOIN students s ON s.user_id=o.student_id JOIN users su ON su.id=o.student_id
             JOIN hostel_blocks b ON b.id=s.block_id WHERE ${scope}`;
  if (req.query.status) { sql += ' AND o.status=?'; params.push(req.query.status); }
  if (req.query.q) { sql += ' AND (su.full_name LIKE ? OR s.roll_number LIKE ? OR s.room_number LIKE ? OR o.destination LIKE ?)'; const q = `%${req.query.q}%`; params.push(q, q, q, q); }
  const [rows] = await db.query(sql + ' ORDER BY o.created_at DESC LIMIT 200', params);
  ok(res, { outpasses: rows });
}
router.get('/outpasses', wrap(list));
router.get('/outpasses/my', wrap(list));

router.get('/outpasses/:id', wrap(async (req, res) => {
  const o = await wf.load(db, req.params.id);
  const { role, id } = req.user;
  let allowed = role === 'admin' || (role === 'student' && o.student_id === id) || (role === 'parent' && o.parent_user_id === id);
  if (role === 'warden') { const [w] = await db.query('SELECT block_id FROM wardens WHERE user_id=?', [id]); allowed = w[0]?.block_id === o.block_id; }
  if (!allowed) throw new wf.HttpError(403, 'You are not authorized to view this outpass.');
  const [timeline] = await db.query(
    `SELECT h.*, u.full_name AS actor FROM outpass_status_history h LEFT JOIN users u ON u.id=h.actor_id
     WHERE outpass_id=? ORDER BY h.id`, [o.id]);
  const [records] = await db.query('SELECT * FROM check_in_out_records WHERE outpass_id=? ORDER BY id', [o.id]);
  ok(res, { outpass: o, timeline, records });
}));

const act = (role, fn) => [authorizeRoles(role), wrap(async (req, res) => { await fn(req); ok(res, { message: 'Done.' }); })];
router.put('/outpasses/:id/cancel', ...act('student', (r) => wf.cancel(r.user, r.params.id, r.ip)));
router.post('/outpasses/:id/parent-approve', ...act('parent', (r) => wf.parentDecide(r.user, r.params.id, true, null, r.ip)));
router.post('/outpasses/:id/parent-reject', ...act('parent', (r) => wf.parentDecide(r.user, r.params.id, false, r.body.reason, r.ip)));
router.post('/outpasses/:id/warden-approve', ...act('warden', (r) => wf.wardenDecide(r.user, r.params.id, true, null, r.ip)));
router.post('/outpasses/:id/warden-reject', ...act('warden', (r) => wf.wardenDecide(r.user, r.params.id, false, r.body.reason, r.ip)));
router.post('/outpasses/:id/check-out', ...act('student', (r) => wf.checkOut(r.user, r.params.id, r.body.gate, r.ip)));
router.post('/outpasses/:id/check-in', ...act('student', (r) => wf.checkIn(r.user, r.params.id, r.body.gate, r.body.notes, r.ip)));

// ---------- Warden dashboard ----------
router.get('/warden/dashboard', authenticateUser, authorizeRoles('warden'), wrap(async (req, res) => {
  const [w] = await db.query('SELECT w.block_id, b.code FROM wardens w JOIN hostel_blocks b ON b.id=w.block_id WHERE w.user_id=?', [req.user.id]);
  if (!w[0]) throw new wf.HttpError(404, 'No block assigned.');
  const [[t]] = await db.query('SELECT COUNT(*) n FROM students WHERE block_id=?', [w[0].block_id]);
  const [counts] = await db.query(
    `SELECT o.status, COUNT(*) n FROM outpasses o JOIN students s ON s.user_id=o.student_id
     WHERE s.block_id=? AND o.created_at >= DATE_FORMAT(NOW(),'%Y-%m-01') GROUP BY o.status`, [w[0].block_id]);
  const [overdue] = await db.query(
    `SELECT o.id, u.full_name, s.room_number, o.expected_return_at FROM outpasses o
     JOIN students s ON s.user_id=o.student_id JOIN users u ON u.id=o.student_id
     WHERE s.block_id=? AND o.status='OVERDUE'`, [w[0].block_id]);
  const [[avg]] = await db.query(
    `SELECT AVG(TIMESTAMPDIFF(MINUTE,p.created_at,a.created_at)) mins FROM outpass_status_history p
     JOIN outpass_status_history a ON a.outpass_id=p.outpass_id AND a.to_status='WARDEN_APPROVED'
     JOIN outpasses o ON o.id=p.outpass_id JOIN students s ON s.user_id=o.student_id
     WHERE p.to_status='PENDING_WARDEN_APPROVAL' AND s.block_id=?`, [w[0].block_id]);
  ok(res, { block: w[0].code, total_students: t.n, status_counts_this_month: counts, overdue, avg_approval_minutes: avg.mins });
}));
router.get('/warden/pending-requests', authenticateUser, authorizeRoles('warden'), (req, res, next) => {
  req.query.status = 'PENDING_WARDEN_APPROVAL'; list(req, res).catch(next);
});

// ---------- Notifications ----------
router.get('/notifications', authenticateUser, wrap(async (req, res) => {
  const [rows] = await db.query('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100', [req.user.id]);
  ok(res, { notifications: rows });
}));
router.put('/notifications/:id/read', authenticateUser, wrap(async (req, res) => {
  await db.query('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  ok(res, { message: 'Marked read.' });
}));

module.exports = router;
