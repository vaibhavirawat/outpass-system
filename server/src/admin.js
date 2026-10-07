const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('./db');
const { HttpError, tx } = require('./workflow');
const { authenticateUser, authorizeRoles } = require('./auth');

router.use(authenticateUser, authorizeRoles('admin'));
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const ok = (res, data, status = 200) => res.status(status).json({ success: true, ...data });
const bad = (m) => new HttpError(400, m);
const like = (q) => `%${q || ''}%`;

const log = (c, user, action, entity, id, desc, ip) => c.query(
  'INSERT INTO audit_logs (user_id,action,entity,entity_id,description,ip) VALUES (?,?,?,?,?,?)',
  [user.id, action, entity, id, desc, ip]);

function checkNewUser(b) {
  if (!/^\S+@\S+\.\S+$/.test(b.email || '')) throw bad('A valid email is required.');
  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(b.password || '')) throw bad('Password needs 8+ characters with upper, lower and a digit.');
  if (!b.full_name?.trim()) throw bad('Full name is required.');
}
async function createUser(c, role, b) {
  const hash = await bcrypt.hash(b.password, 10);
  const [r] = await c.query('INSERT INTO users (email,password_hash,role,full_name,phone_number) VALUES (?,?,?,?,?)',
    [b.email.toLowerCase(), hash, role, b.full_name.trim(), b.phone_number || null]);
  return r.insertId;
}
// column names below always come from hard-coded whitelists, values are parameterised
async function patch(c, table, key, id, b, fields) {
  const cols = fields.filter((f) => b[f] !== undefined);
  if (!cols.length) return;
  await c.query(`UPDATE ${table} SET ${cols.map((f) => `${f}=?`).join(',')} WHERE ${key}=?`,
    [...cols.map((f) => (b[f] === '' ? null : b[f])), id]);
}
async function checkBlock(c, blockId, gender) {
  const [r] = await c.query('SELECT gender FROM hostel_blocks WHERE id=?', [blockId]);
  if (!r[0]) throw bad('Hostel block not found.');
  if (gender && r[0].gender !== gender) throw bad('Gender does not match the hostel block.');
}
async function checkParent(c, id) {
  const [r] = await c.query('SELECT 1 FROM parents WHERE user_id=?', [id]);
  if (!r[0]) throw bad('Parent not found.');
}

router.get('/summary', wrap(async (req, res) => {
  const [[s]] = await db.query(`SELECT
    (SELECT COUNT(*) FROM students) students, (SELECT COUNT(*) FROM parents) parents,
    (SELECT COUNT(*) FROM wardens) wardens, (SELECT COUNT(*) FROM hostel_blocks) blocks,
    (SELECT COUNT(*) FROM outpasses) outpasses,
    (SELECT COUNT(*) FROM outpasses WHERE status='OVERDUE') overdue,
    (SELECT COUNT(*) FROM outpasses WHERE status='ACTIVE') active`);
  ok(res, { summary: s });
}));
router.get('/audit-logs', wrap(async (req, res) => {
  const [rows] = await db.query(`SELECT a.*, u.full_name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 100`);
  ok(res, { logs: rows });
}));

// ---- Blocks ----
router.get('/blocks', wrap(async (req, res) => {
  const [rows] = await db.query(`SELECT b.id, b.code, b.gender,
    (SELECT COUNT(*) FROM students s WHERE s.block_id=b.id) AS student_count,
    (SELECT GROUP_CONCAT(u.full_name SEPARATOR ', ') FROM wardens w JOIN users u ON u.id=w.user_id WHERE w.block_id=b.id) AS warden_name
    FROM hostel_blocks b ORDER BY b.gender DESC, LENGTH(b.code), b.code`);
  ok(res, { rows });
}));
router.post('/blocks', wrap(async (req, res) => {
  const { code, gender } = req.body;
  if (!/^[A-Za-z0-9]{1,10}$/.test(code || '') || !['M', 'F'].includes(gender)) throw bad('Valid block code and gender (M/F) required.');
  const [r] = await db.query('INSERT INTO hostel_blocks (code,gender) VALUES (?,?)', [code.toUpperCase(), gender]);
  await log(db, req.user, 'ADMIN_CREATED_BLOCK', 'block', r.insertId, `Created block ${code}`, req.ip);
  ok(res, { id: r.insertId }, 201);
}));
router.put('/blocks/:id', wrap(async (req, res) => {
  if (!/^[A-Za-z0-9]{1,10}$/.test(req.body.code || '')) throw bad('Valid block code required.');
  await db.query('UPDATE hostel_blocks SET code=? WHERE id=?', [req.body.code.toUpperCase(), req.params.id]);
  await log(db, req.user, 'ADMIN_UPDATED_BLOCK', 'block', req.params.id, `Renamed block to ${req.body.code}`, req.ip);
  ok(res, { message: 'Updated.' });
}));

// ---- Students ----
const STUDENT_SQL = `SELECT u.id, u.full_name, u.email, u.phone_number, u.account_status, s.roll_number, s.gender,
  DATE_FORMAT(s.date_of_birth,'%Y-%m-%d') AS date_of_birth, s.course, s.branch, s.year_of_study, s.semester,
  s.block_id, b.code AS block, s.room_number, s.parent_user_id, pu.full_name AS parent_name, s.emergency_contact
  FROM students s JOIN users u ON u.id=s.user_id JOIN hostel_blocks b ON b.id=s.block_id JOIN users pu ON pu.id=s.parent_user_id`;
router.get('/students', wrap(async (req, res) => {
  const q = like(req.query.q);
  const [rows] = await db.query(`${STUDENT_SQL} WHERE u.full_name LIKE ? OR s.roll_number LIKE ? OR u.email LIKE ? OR s.room_number LIKE ? ORDER BY u.id LIMIT 200`, [q, q, q, q]);
  ok(res, { rows });
}));
router.post('/students', wrap(async (req, res) => {
  const b = req.body; checkNewUser(b);
  if (!b.roll_number || !['M', 'F'].includes(b.gender) || !b.block_id || !b.parent_user_id) throw bad('Roll number, gender, block and parent are required.');
  const id = await tx(async (c) => {
    await checkBlock(c, b.block_id, b.gender); await checkParent(c, b.parent_user_id);
    const uid = await createUser(c, 'student', b);
    await c.query(`INSERT INTO students (user_id,roll_number,gender,date_of_birth,course,branch,year_of_study,semester,block_id,room_number,parent_user_id,emergency_contact)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [uid, b.roll_number, b.gender, b.date_of_birth || null, b.course || null, b.branch || null,
      b.year_of_study || null, b.semester || null, b.block_id, b.room_number || null, b.parent_user_id, b.emergency_contact || null]);
    await log(c, req.user, 'ADMIN_CREATED_STUDENT', 'user', uid, `Created student ${b.roll_number}`, req.ip);
    return uid;
  });
  ok(res, { id }, 201);
}));
router.put('/students/:id', wrap(async (req, res) => {
  const b = req.body, id = Number(req.params.id);
  await tx(async (c) => {
    const [s] = await c.query('SELECT gender, block_id, parent_user_id FROM students WHERE user_id=?', [id]);
    if (!s[0]) throw new HttpError(404, 'Student not found.');
    if (b.block_id) await checkBlock(c, b.block_id, s[0].gender);
    if (b.parent_user_id) await checkParent(c, b.parent_user_id);
    await patch(c, 'users', 'id', id, b, ['full_name', 'phone_number']);
    await patch(c, 'students', 'user_id', id, b, ['date_of_birth', 'course', 'branch', 'year_of_study', 'semester', 'block_id', 'room_number', 'parent_user_id', 'emergency_contact']);
    const moved = b.block_id && Number(b.block_id) !== s[0].block_id, relinked = b.parent_user_id && Number(b.parent_user_id) !== s[0].parent_user_id;
    await log(c, req.user, 'ADMIN_UPDATED_STUDENT', 'user', id, `Updated student${moved ? ' (block changed)' : ''}${relinked ? ' (parent re-linked)' : ''}`, req.ip);
  });
  ok(res, { message: 'Updated.' });
}));

// ---- Parents ----
router.get('/parents', wrap(async (req, res) => {
  const q = like(req.query.q);
  const [rows] = await db.query(`SELECT u.id, u.full_name, u.email, u.phone_number, u.account_status, p.relationship, p.address,
    (SELECT GROUP_CONCAT(su.full_name SEPARATOR ', ') FROM students s JOIN users su ON su.id=s.user_id WHERE s.parent_user_id=p.user_id) AS children
    FROM parents p JOIN users u ON u.id=p.user_id WHERE u.full_name LIKE ? OR u.email LIKE ? ORDER BY u.id LIMIT 200`, [q, q]);
  ok(res, { rows });
}));
router.post('/parents', wrap(async (req, res) => {
  const b = req.body; checkNewUser(b);
  const id = await tx(async (c) => {
    const uid = await createUser(c, 'parent', b);
    await c.query('INSERT INTO parents (user_id,relationship,address) VALUES (?,?,?)', [uid, b.relationship || null, b.address || null]);
    await log(c, req.user, 'ADMIN_CREATED_PARENT', 'user', uid, `Created parent ${b.email}`, req.ip);
    return uid;
  });
  ok(res, { id }, 201);
}));
router.put('/parents/:id', wrap(async (req, res) => {
  await tx(async (c) => {
    await patch(c, 'users', 'id', req.params.id, req.body, ['full_name', 'phone_number']);
    await patch(c, 'parents', 'user_id', req.params.id, req.body, ['relationship', 'address']);
    await log(c, req.user, 'ADMIN_UPDATED_PARENT', 'user', req.params.id, 'Updated parent', req.ip);
  });
  ok(res, { message: 'Updated.' });
}));

// ---- Wardens ----
router.get('/wardens', wrap(async (req, res) => {
  const q = like(req.query.q);
  const [rows] = await db.query(`SELECT u.id, u.full_name, u.email, u.phone_number, u.account_status, w.employee_id, w.gender, w.designation, w.block_id, b.code AS block
    FROM wardens w JOIN users u ON u.id=w.user_id LEFT JOIN hostel_blocks b ON b.id=w.block_id
    WHERE u.full_name LIKE ? OR u.email LIKE ? OR w.employee_id LIKE ? ORDER BY u.id LIMIT 200`, [q, q, q]);
  ok(res, { rows });
}));
router.post('/wardens', wrap(async (req, res) => {
  const b = req.body; checkNewUser(b);
  if (!b.employee_id || !['M', 'F'].includes(b.gender)) throw bad('Employee ID and gender are required.');
  const id = await tx(async (c) => {
    if (b.block_id) await checkBlock(c, b.block_id, b.gender);
    const uid = await createUser(c, 'warden', b);
    await c.query('INSERT INTO wardens (user_id,employee_id,gender,designation,block_id) VALUES (?,?,?,?,?)',
      [uid, b.employee_id, b.gender, b.designation || 'Hostel Warden', b.block_id || null]);
    await log(c, req.user, 'ADMIN_CREATED_WARDEN', 'user', uid, `Created warden ${b.employee_id}`, req.ip);
    return uid;
  });
  ok(res, { id }, 201);
}));
router.put('/wardens/:id', wrap(async (req, res) => {
  const b = req.body, id = Number(req.params.id);
  await tx(async (c) => {
    const [w] = await c.query('SELECT gender, block_id FROM wardens WHERE user_id=?', [id]);
    if (!w[0]) throw new HttpError(404, 'Warden not found.');
    if (b.block_id) await checkBlock(c, b.block_id, w[0].gender);
    await patch(c, 'users', 'id', id, b, ['full_name', 'phone_number']);
    await patch(c, 'wardens', 'user_id', id, b, ['designation', 'block_id']);
    const changed = b.block_id !== undefined && (Number(b.block_id) || null) !== w[0].block_id;
    await log(c, req.user, changed ? 'ADMIN_CHANGED_WARDEN_ASSIGNMENT' : 'ADMIN_UPDATED_WARDEN', 'user', id,
      changed ? `Warden block ${w[0].block_id} → ${b.block_id || 'none'}` : 'Updated warden', req.ip);
  });
  ok(res, { message: 'Updated.' });
}));

// ---- Activate / deactivate any non-admin-self account ----
router.put('/users/:id/status', wrap(async (req, res) => {
  const { status } = req.body;
  if (!['ACTIVE', 'INACTIVE'].includes(status)) throw bad('Invalid status.');
  if (Number(req.params.id) === req.user.id) throw new HttpError(409, 'You cannot change your own status.');
  const [r] = await db.query('UPDATE users SET account_status=? WHERE id=?', [status, req.params.id]);
  if (!r.affectedRows) throw new HttpError(404, 'User not found.');
  await log(db, req.user, status === 'ACTIVE' ? 'ADMIN_ACTIVATED_USER' : 'ADMIN_DEACTIVATED_USER', 'user', req.params.id, `Account set to ${status}`, req.ip);
  ok(res, { message: 'Updated.' });
}));

module.exports = router;
