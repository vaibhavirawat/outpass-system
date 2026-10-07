process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.DB_NAME = process.env.DB_NAME || 'outpass_test';
const request = require('supertest');
const db = require('../src/db');
const wf = require('../src/workflow');
const { app } = require('../src/server');

// Seeded facts: student031 (block G7) ← parent031, warden007. Unrelated: parent001, warden001.
const STUDENT = 'student031@example.com', PARENT = 'parent031@example.com', WARDEN = 'warden007@example.com';
const OTHER_PARENT = 'parent001@example.com', OTHER_WARDEN = 'warden001@example.com';
const T = {};
const hrs = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const login = async (email, pw) => (await request(app).post('/api/auth/login').send({ email, password: pw })).body.token;
const as = (t) => ({ Authorization: `Bearer ${t}` });
const post = (t, url, body = {}) => request(app).post(url).set(as(t)).send(body);
const create = (extra = {}) => post(T.student, '/api/outpasses', { type: 'DAY_OUT', from_at: hrs(-1), until_at: hrs(24), destination: 'Test City', purpose: 'Testing', ...extra });
const status = async (id) => (await request(app).get(`/api/outpasses/${id}`).set(as(T.student))).body.outpass.status;
const notifCount = async (email, type, id) => (await db.query(
  'SELECT COUNT(*) n FROM notifications n JOIN users u ON u.id=n.user_id WHERE u.email=? AND n.type=? AND n.outpass_id=?', [email, type, id]))[0][0].n;

beforeAll(async () => {
  const [[u]] = await db.query('SELECT id FROM users WHERE email=?', [STUDENT]);
  const ids = (await db.query('SELECT id FROM outpasses WHERE student_id=?', [u.id]))[0].map((r) => r.id);
  if (ids.length) for (const t of ['notifications', 'check_in_out_records', 'outpass_status_history', 'video_calls', 'outpasses'])
    await db.query(`DELETE FROM ${t} WHERE ${t === 'outpasses' ? 'id' : 'outpass_id'} IN (?)`, [ids]);
  T.student = await login(STUDENT, 'Student@123'); T.parent = await login(PARENT, 'Parent@123');
  T.warden = await login(WARDEN, 'Warden@123'); T.oParent = await login(OTHER_PARENT, 'Parent@123');
  T.oWarden = await login(OTHER_WARDEN, 'Warden@123');
});
afterAll(() => db.end());

describe('authentication', () => {
  test('valid login returns token and user', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: STUDENT, password: 'Student@123' });
    expect(r.status).toBe(200); expect(r.body.token).toBeTruthy(); expect(r.body.user.role).toBe('student');
    expect(JSON.stringify(r.body)).not.toMatch(/password/i);
  });
  test('wrong password → 401', async () =>
    expect((await request(app).post('/api/auth/login').send({ email: STUDENT, password: 'nope' })).status).toBe(401));
  test('no token → 401', async () => expect((await request(app).get('/api/outpasses')).status).toBe(401));
  test('role guard: student cannot use admin API', async () =>
    expect((await request(app).get('/api/admin/summary').set(as(T.student))).status).toBe(403));
});

describe('approval workflow', () => {
  test('student creates outpass → pending parent, parent notified', async () => {
    const r = await create(); expect(r.status).toBe(201); T.id = r.body.id;
    expect(await status(T.id)).toBe('PENDING_PARENT_APPROVAL');
    expect(await notifCount(PARENT, 'NEW_REQUEST', T.id)).toBe(1);
  });
  test('conflicting overlapping outpass is refused', async () => expect((await create()).status).toBe(409));
  test('warden cannot approve before parent', async () => expect((await post(T.warden, `/api/outpasses/${T.id}/warden-approve`)).status).toBe(409));
  test('student cannot approve own request', async () => expect((await post(T.student, `/api/outpasses/${T.id}/parent-approve`)).status).toBe(403));
  test('unrelated parent cannot approve', async () => expect((await post(T.oParent, `/api/outpasses/${T.id}/parent-approve`)).status).toBe(403));
  test('rejection requires a reason', async () => expect((await post(T.parent, `/api/outpasses/${T.id}/parent-reject`)).status).toBe(400));
  test('parent approves → pending warden; warden notified', async () => {
    expect((await post(T.parent, `/api/outpasses/${T.id}/parent-approve`)).status).toBe(200);
    expect(await status(T.id)).toBe('PENDING_WARDEN_APPROVAL');
    expect(await notifCount(WARDEN, 'NEW_REQUEST', T.id)).toBe(1);
  });
  test('warden of another block is blocked (view and approve)', async () => {
    expect((await request(app).get(`/api/outpasses/${T.id}`).set(as(T.oWarden))).status).toBe(403);
    expect((await post(T.oWarden, `/api/outpasses/${T.id}/warden-approve`)).status).toBe(403);
  });
  test('assigned warden approves → APPROVED', async () => {
    expect((await post(T.warden, `/api/outpasses/${T.id}/warden-approve`)).status).toBe(200);
    expect(await status(T.id)).toBe('APPROVED');
    expect(await notifCount(STUDENT, 'WARDEN_APPROVED', T.id)).toBe(1);
  });
});

describe('check-out / check-in', () => {
  test('cannot check in before checking out', async () => expect((await post(T.student, `/api/outpasses/${T.id}/check-in`)).status).toBe(409));
  test('check-out → ACTIVE, parent & warden notified', async () => {
    expect((await post(T.student, `/api/outpasses/${T.id}/check-out`)).status).toBe(200);
    expect(await status(T.id)).toBe('ACTIVE');
    expect(await notifCount(PARENT, 'CHECKED_OUT', T.id)).toBe(1); expect(await notifCount(WARDEN, 'CHECKED_OUT', T.id)).toBe(1);
  });
  test('cannot check out twice', async () => expect((await post(T.student, `/api/outpasses/${T.id}/check-out`)).status).toBe(409));
  test('check-in → CHECKED_IN, cannot repeat', async () => {
    expect((await post(T.student, `/api/outpasses/${T.id}/check-in`)).status).toBe(200);
    expect(await status(T.id)).toBe('CHECKED_IN');
    expect((await post(T.student, `/api/outpasses/${T.id}/check-in`)).status).toBe(409);
  });
  test('timeline records every transition', async () => {
    const r = await request(app).get(`/api/outpasses/${T.id}`).set(as(T.student));
    expect(r.body.timeline.map((t) => t.to_status)).toEqual(['PENDING_PARENT_APPROVAL', 'PARENT_APPROVED', 'PENDING_WARDEN_APPROVAL', 'WARDEN_APPROVED', 'APPROVED', 'ACTIVE', 'CHECKED_IN']);
  });
});

describe('rejections', () => {
  test('parent rejects → closed; warden cannot then approve', async () => {
    const id = (await create()).body.id;
    expect((await post(T.parent, `/api/outpasses/${id}/parent-reject`, { reason: 'Dates conflict' })).status).toBe(200);
    expect(await status(id)).toBe('PARENT_REJECTED');
    expect((await post(T.warden, `/api/outpasses/${id}/warden-approve`)).status).toBe(409);
  });
  test('warden rejects → cannot check out', async () => {
    const id = (await create()).body.id;
    await post(T.parent, `/api/outpasses/${id}/parent-approve`);
    expect((await post(T.warden, `/api/outpasses/${id}/warden-reject`, { reason: 'Exam week' })).status).toBe(200);
    expect(await status(id)).toBe('WARDEN_REJECTED');
    expect((await post(T.student, `/api/outpasses/${id}/check-out`)).status).toBe(409);
    expect(await notifCount(STUDENT, 'WARDEN_REJECTED', id)).toBe(1);
  });
});

describe('overdue detection', () => {
  test('job marks late ACTIVE outpass OVERDUE and notifies all three', async () => {
    const id = (await create({ from_at: hrs(-3), until_at: hrs(2), expected_return_at: hrs(-1) })).body.id;
    await post(T.parent, `/api/outpasses/${id}/parent-approve`);
    await post(T.warden, `/api/outpasses/${id}/warden-approve`);
    expect((await post(T.student, `/api/outpasses/${id}/check-out`)).status).toBe(200);
    const r = await wf.runOverdueJob();
    expect(r.overdue).toBeGreaterThanOrEqual(1);
    expect(await status(id)).toBe('OVERDUE');
    for (const e of [STUDENT, PARENT, WARDEN]) expect(await notifCount(e, 'OVERDUE', id)).toBe(1);
    expect((await post(T.student, `/api/outpasses/${id}/check-in`)).status).toBe(200); // late student can still return
  });
});

describe('video calls', () => {
  test('warden requests call; parent notified, can join; outsider cannot; end works', async () => {
    const id = (await create()).body.id;
    await post(T.parent, `/api/outpasses/${id}/parent-approve`);
    expect((await post(T.oWarden, '/api/video-calls', { outpass_id: id })).status).toBe(403);
    const c = await post(T.warden, '/api/video-calls', { outpass_id: id });
    expect(c.status).toBe(201);
    expect(await notifCount(PARENT, 'VIDEO_CALL', id)).toBe(1);
    expect((await post(T.oParent, `/api/video-calls/${c.body.id}/join`)).status).toBe(403);
    const j = await post(T.parent, `/api/video-calls/${c.body.id}/join`);
    expect(j.status).toBe(200); expect(j.body.iceServers.length).toBeGreaterThan(0);
    expect((await post(T.warden, `/api/video-calls/${c.body.id}/end`)).status).toBe(200);
    expect((await post(T.parent, `/api/video-calls/${c.body.id}/join`)).status).toBe(409);
  });
});

describe('admin', () => {
  let admin, parentId; const tag = Date.now();
  beforeAll(async () => {
    admin = await login('admin@example.com', 'Admin@123');
    parentId = (await db.query('SELECT id FROM users WHERE email=?', [OTHER_PARENT]))[0][0].id;
  });
  const body = (o = {}) => ({ email: `new${tag}@example.com`, password: 'Newpass1', full_name: 'Test Student', roll_number: `TST${tag}`, gender: 'F', block_id: 1, parent_user_id: parentId, ...o });
  test('rejects weak password and gender/block mismatch', async () => {
    expect((await post(admin, '/api/admin/students', body({ password: 'weak' }))).status).toBe(400);
    expect((await post(admin, '/api/admin/students', body({ block_id: 9 }))).status).toBe(400);
  });
  test('creates student, duplicate → 409, deactivated account cannot log in', async () => {
    const r = await post(admin, '/api/admin/students', body()); expect(r.status).toBe(201);
    expect((await post(admin, '/api/admin/students', body())).status).toBe(409);
    expect((await request(app).put(`/api/admin/users/${r.body.id}/status`).set(as(admin)).send({ status: 'INACTIVE' })).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: `new${tag}@example.com`, password: 'Newpass1' })).status).toBe(401);
  });
});
