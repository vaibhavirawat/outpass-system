const db = require('./db');
const { send } = require('./notifier');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const TRANSITIONS = {
  PENDING_PARENT_APPROVAL: ['PARENT_APPROVED', 'PARENT_REJECTED', 'CANCELLED'],
  PARENT_APPROVED: ['PENDING_WARDEN_APPROVAL'],
  PENDING_WARDEN_APPROVAL: ['WARDEN_APPROVED', 'WARDEN_REJECTED', 'CANCELLED'],
  WARDEN_APPROVED: ['APPROVED'],
  APPROVED: ['ACTIVE', 'EXPIRED', 'CANCELLED'],
  ACTIVE: ['CHECKED_IN', 'OVERDUE'],
  OVERDUE: ['CHECKED_IN'],
};
const OPEN = ['PENDING_PARENT_APPROVAL', 'PARENT_APPROVED', 'PENDING_WARDEN_APPROVAL',
  'WARDEN_APPROVED', 'APPROVED', 'ACTIVE', 'OVERDUE'];

async function tx(fn) {
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const r = await fn(c);
    await c.commit();
    return r;
  } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}

const audit = (c, userId, action, id, desc, ip) => c.query(
  'INSERT INTO audit_logs (user_id,action,entity,entity_id,description,ip) VALUES (?,?,?,?,?,?)',
  [userId, action, 'outpass', id, desc, ip || null]);

async function load(c, id, lock = false) {
  const [r] = await c.query(
    `SELECT o.*, s.block_id, s.parent_user_id, s.room_number, su.full_name AS student_name,
            w.user_id AS warden_id
     FROM outpasses o JOIN students s ON s.user_id=o.student_id
     JOIN users su ON su.id=o.student_id
     LEFT JOIN wardens w ON w.block_id=s.block_id
     WHERE o.id=? ${lock ? 'FOR UPDATE' : ''}`, [id]);
  if (!r[0]) throw new HttpError(404, 'Outpass not found.');
  return r[0];
}

async function move(c, o, to, actor, note, ip) {
  if (!(TRANSITIONS[o.status] || []).includes(to))
    throw new HttpError(409, `Invalid transition: ${o.status} → ${to}.`);
  await c.query('UPDATE outpasses SET status=? WHERE id=?', [to, o.id]);
  await c.query('INSERT INTO outpass_status_history (outpass_id,from_status,to_status,actor_id,note) VALUES (?,?,?,?,?)',
    [o.id, o.status, to, actor, note || null]);
  o.status = to;
}

const fmt = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

exports.create = (user, b, ip) => tx(async (c) => {
  const need = ['type', 'from_at', 'until_at', 'destination', 'purpose'];
  for (const k of need) if (!b[k]) throw new HttpError(400, `${k} is required.`);
  if (!['DAY_OUT', 'OVERNIGHT', 'EMERGENCY', 'WEEKEND'].includes(b.type)) throw new HttpError(400, 'Invalid outpass type.');
  const from = new Date(b.from_at), until = new Date(b.until_at);
  const ret = b.expected_return_at ? new Date(b.expected_return_at) : until;
  if (isNaN(from) || isNaN(until) || isNaN(ret)) throw new HttpError(400, 'Invalid date/time.');
  if (until <= from) throw new HttpError(400, 'Until must be after From.');
  if (until < new Date()) throw new HttpError(400, 'Outpass period is already over.');

  const [ov] = await c.query(
    `SELECT id FROM outpasses WHERE student_id=? AND status IN (${OPEN.map(() => '?').join(',')})
     AND from_at < ? AND until_at > ? FOR UPDATE`, [user.id, ...OPEN, until, from]);
  if (ov.length) throw new HttpError(409, 'You already have a conflicting outpass for this period.');

  const [st] = await c.query('SELECT parent_user_id FROM students WHERE user_id=?', [user.id]);
  if (!st[0]) throw new HttpError(403, 'Only students can apply.');
  const [r] = await c.query(
    `INSERT INTO outpasses (student_id,type,from_at,until_at,expected_return_at,destination,purpose,description,emergency_contact)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [user.id, b.type, from, until, ret, b.destination, b.purpose, b.description || null, b.emergency_contact || null]);
  const id = r.insertId;
  await c.query('INSERT INTO outpass_status_history (outpass_id,from_status,to_status,actor_id,note) VALUES (?,?,?,?,?)',
    [id, null, 'PENDING_PARENT_APPROVAL', user.id, 'Student submitted request']);
  await audit(c, user.id, 'OUTPASS_SUBMITTED', id, 'Student submitted outpass', ip);
  await send(c, user.id, 'SUBMITTED', 'Your outpass request was submitted and awaits parent approval.', id);
  await send(c, st[0].parent_user_id, 'NEW_REQUEST',
    `New outpass request from ${user.full_name} to ${b.destination} (${fmt(from)} – ${fmt(until)}).`, id);
  return id;
});

exports.parentDecide = (user, id, approve, reason, ip) => tx(async (c) => {
  const o = await load(c, id, true);
  if (o.parent_user_id !== user.id) throw new HttpError(403, 'This request does not belong to your child.');
  if (!approve && !reason) throw new HttpError(400, 'A rejection reason is required.');
  if (approve) {
    await move(c, o, 'PARENT_APPROVED', user.id, 'Parent approved', ip);
    await move(c, o, 'PENDING_WARDEN_APPROVAL', null, 'Forwarded to warden', ip);
    await c.query('UPDATE outpasses SET parent_reason=NULL WHERE id=?', [id]);
    await send(c, o.student_id, 'PARENT_APPROVED', 'Your parent approved the outpass. Awaiting warden.', id);
    await send(c, o.warden_id, 'NEW_REQUEST', `Parent-approved outpass request from ${o.student_name}.`, id);
  } else {
    await c.query('UPDATE outpasses SET parent_reason=? WHERE id=?', [reason, id]);
    await move(c, o, 'PARENT_REJECTED', user.id, `Parent rejected: ${reason}`, ip);
    await send(c, o.student_id, 'PARENT_REJECTED', `Your parent rejected the outpass: ${reason}`, id);
  }
  await audit(c, user.id, approve ? 'PARENT_APPROVED' : 'PARENT_REJECTED', id, reason || 'Parent approved', ip);
});

exports.wardenDecide = (user, id, approve, reason, ip) => tx(async (c) => {
  const o = await load(c, id, true);
  const [w] = await c.query('SELECT block_id FROM wardens WHERE user_id=?', [user.id]);
  if (!w[0] || w[0].block_id !== o.block_id) throw new HttpError(403, 'This student is not in your block.');
  if (!approve && !reason) throw new HttpError(400, 'A rejection reason is required.');
  if (approve) {
    await move(c, o, 'WARDEN_APPROVED', user.id, 'Warden approved', ip);
    await move(c, o, 'APPROVED', null, 'Outpass issued', ip);
  } else {
    await c.query('UPDATE outpasses SET warden_reason=? WHERE id=?', [reason, id]);
    await move(c, o, 'WARDEN_REJECTED', user.id, `Warden rejected: ${reason}`, ip);
  }
  const msg = approve ? 'The outpass was approved by the warden.' : `The outpass was rejected by the warden: ${reason}`;
  for (const u of [o.student_id, o.parent_user_id])
    await send(c, u, approve ? 'WARDEN_APPROVED' : 'WARDEN_REJECTED', msg, id);
  await audit(c, user.id, approve ? 'WARDEN_APPROVED' : 'WARDEN_REJECTED', id, reason || 'Warden approved', ip);
});

exports.cancel = (user, id, ip) => tx(async (c) => {
  const o = await load(c, id, true);
  if (o.student_id !== user.id) throw new HttpError(403, 'Not your outpass.');
  await move(c, o, 'CANCELLED', user.id, 'Student cancelled', ip);
  await audit(c, user.id, 'OUTPASS_CANCELLED', id, 'Student cancelled', ip);
});

exports.checkOut = (user, id, gate, ip) => tx(async (c) => {
  const o = await load(c, id, true);
  if (o.student_id !== user.id) throw new HttpError(403, 'Not your outpass.');
  if (o.status !== 'APPROVED') throw new HttpError(409, 'Outpass must be APPROVED to check out.');
  const now = new Date();
  if (now > new Date(o.until_at)) { await move(c, o, 'EXPIRED', null, 'Expired before check-out', ip); throw new HttpError(409, 'Outpass has expired.'); }
  if (now < new Date(o.from_at)) throw new HttpError(409, 'Outpass period has not started yet.');
  await c.query('INSERT INTO check_in_out_records (outpass_id,student_id,kind,gate,verified_by) VALUES (?,?,?,?,?)',
    [id, user.id, 'CHECK_OUT', gate || 'Main Gate', user.id]);
  await move(c, o, 'ACTIVE', user.id, 'Student checked out', ip);
  await audit(c, user.id, 'CHECKED_OUT', id, 'Student checked out', ip);
  const m = `${o.student_name} checked out at ${fmt(now)}.`;
  for (const u of [o.student_id, o.parent_user_id, o.warden_id]) await send(c, u, 'CHECKED_OUT', m, id);
});

exports.checkIn = (user, id, gate, notes, ip) => tx(async (c) => {
  const o = await load(c, id, true);
  if (o.student_id !== user.id) throw new HttpError(403, 'Not your outpass.');
  if (!['ACTIVE', 'OVERDUE'].includes(o.status)) throw new HttpError(409, 'You are not currently checked out on this outpass.');
  await c.query('INSERT INTO check_in_out_records (outpass_id,student_id,kind,gate,notes,verified_by) VALUES (?,?,?,?,?,?)',
    [id, user.id, 'CHECK_IN', gate || 'Main Gate', notes || null, user.id]);
  await move(c, o, 'CHECKED_IN', user.id, 'Student checked in', ip);
  await audit(c, user.id, 'CHECKED_IN', id, 'Student checked in', ip);
  const m = `${o.student_name} checked in at ${fmt(new Date())}.`;
  for (const u of [o.student_id, o.parent_user_id, o.warden_id]) await send(c, u, 'CHECKED_IN', m, id);
});

// Called by cron: marks late students OVERDUE and lapsed approvals EXPIRED
exports.runOverdueJob = () => tx(async (c) => {
  const [late] = await c.query("SELECT id FROM outpasses WHERE status='ACTIVE' AND expected_return_at < NOW() FOR UPDATE");
  for (const { id } of late) {
    const o = await load(c, id);
    await move(c, o, 'OVERDUE', null, 'Not checked in by expected return time');
    const m = `${o.student_name} has not returned by the expected time.`;
    for (const u of [o.student_id, o.parent_user_id, o.warden_id]) await send(c, u, 'OVERDUE', m, id);
  }
  const [exp] = await c.query("SELECT id FROM outpasses WHERE status='APPROVED' AND until_at < NOW() FOR UPDATE");
  for (const { id } of exp) {
    const o = await load(c, id);
    await move(c, o, 'EXPIRED', null, 'Approved outpass was never used');
    await send(c, o.student_id, 'EXPIRED', 'Your approved outpass expired unused.', id);
  }
  return { overdue: late.length, expired: exp.length };
});

exports.load = load;
exports.HttpError = HttpError;
exports.tx = tx;
