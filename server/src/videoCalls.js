const router = require('express').Router();
const db = require('./db');
const wf = require('./workflow');
const notifier = require('./notifier');
const { authenticateUser, authorizeRoles } = require('./auth');

router.use(authenticateUser);
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const ok = (res, data, status = 200) => res.status(status).json({ success: true, ...data });

// STUN is enough on localhost / friendly networks. Restrictive NATs need a TURN server (set TURN_* env vars).
const iceServers = () => {
  const list = [{ urls: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302').split(',') }];
  if (process.env.TURN_URL) list.push({ urls: process.env.TURN_URL, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
  return list;
};

async function getCall(id, user) {
  const [r] = await db.query(
    `SELECT v.*, w.full_name AS warden_name, p.full_name AS parent_name, s.full_name AS student_name
     FROM video_calls v JOIN users w ON w.id=v.warden_id JOIN users p ON p.id=v.parent_id
     JOIN outpasses o ON o.id=v.outpass_id JOIN users s ON s.id=o.student_id WHERE v.id=?`, [id]);
  const c = r[0];
  if (!c) throw new wf.HttpError(404, 'Call not found.');
  if (![c.warden_id, c.parent_id].includes(user.id)) throw new wf.HttpError(403, 'You are not a participant of this call.');
  return c;
}
const other = (c, user) => (user.id === c.warden_id ? c.parent_id : c.warden_id);

router.post('/', authorizeRoles('warden'), wrap(async (req, res) => {
  const o = await wf.load(db, req.body.outpass_id);
  const [w] = await db.query('SELECT block_id FROM wardens WHERE user_id=?', [req.user.id]);
  if (w[0]?.block_id !== o.block_id) throw new wf.HttpError(403, 'This student is not in your block.');
  if (o.status !== 'PENDING_WARDEN_APPROVAL') throw new wf.HttpError(409, 'Video calls can be requested while the request awaits warden approval.');
  const [r] = await db.query('INSERT INTO video_calls (outpass_id,warden_id,parent_id) VALUES (?,?,?)', [o.id, req.user.id, o.parent_user_id]);
  await notifier.send(db, o.parent_user_id, 'VIDEO_CALL',
    `Warden ${req.user.full_name} has requested a video call regarding ${o.student_name}'s outpass request.`, o.id);
  await notifier.send(db, o.student_id, 'VIDEO_CALL', 'The warden requested a video call with your parent.', o.id);
  notifier.emit(o.parent_user_id, 'call:incoming', { call_id: r.insertId, from: req.user.full_name, student: o.student_name });
  await db.query('INSERT INTO audit_logs (user_id,action,entity,entity_id,description,ip) VALUES (?,?,?,?,?,?)',
    [req.user.id, 'VIDEO_CALL_REQUESTED', 'outpass', o.id, 'Warden requested parent video call', req.ip]);
  ok(res, { id: r.insertId }, 201);
}));

router.post('/:id/join', wrap(async (req, res) => {
  const c = await getCall(req.params.id, req.user);
  if (['DECLINED', 'ENDED'].includes(c.status)) throw new wf.HttpError(409, 'This call is no longer available.');
  if (req.user.id === c.parent_id && c.status === 'REQUESTED') {
    await db.query("UPDATE video_calls SET status='ACTIVE' WHERE id=?", [c.id]);
    c.status = 'ACTIVE';
  }
  ok(res, { call: c, iceServers: iceServers() });
}));

router.post('/:id/decline', authorizeRoles('parent'), wrap(async (req, res) => {
  const c = await getCall(req.params.id, req.user);
  if (c.status !== 'REQUESTED') throw new wf.HttpError(409, 'Call can no longer be declined.');
  await db.query("UPDATE video_calls SET status='DECLINED', ended_at=NOW() WHERE id=?", [c.id]);
  await notifier.send(db, c.warden_id, 'VIDEO_CALL_DECLINED', `Parent ${c.parent_name} declined the video call.`, c.outpass_id);
  notifier.emit(c.warden_id, 'call:ended', { call_id: c.id, reason: 'declined' });
  notifier.emitRoom(`call:${c.id}`, 'call:ended', { call_id: c.id, reason: 'declined' });
  ok(res, { message: 'Declined.' });
}));

router.post('/:id/end', wrap(async (req, res) => {
  const c = await getCall(req.params.id, req.user);
  if (!['ENDED', 'DECLINED'].includes(c.status)) await db.query("UPDATE video_calls SET status='ENDED', ended_at=NOW() WHERE id=?", [c.id]);
  notifier.emit(other(c, req.user), 'call:ended', { call_id: c.id, reason: 'ended' });
  notifier.emitRoom(`call:${c.id}`, 'call:ended', { call_id: c.id, reason: 'ended' });
  ok(res, { message: 'Call ended.' });
}));

module.exports = router;
