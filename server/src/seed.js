require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const FIRST_F = ['Aanya', 'Diya', 'Ishita', 'Kavya', 'Meera', 'Nisha', 'Riya', 'Sara', 'Tara', 'Vaani'];
const FIRST_M = ['Aarav', 'Dev', 'Ishaan', 'Kabir', 'Manav', 'Nikhil', 'Rohan', 'Samar', 'Tejas', 'Yash'];
const LAST = ['Sharma', 'Verma', 'Rao', 'Nair', 'Gupta', 'Mehta', 'Iyer', 'Bose', 'Singh', 'Patel'];
const BRANCHES = [['B.Tech', 'CS'], ['B.Tech', 'EC'], ['B.Tech', 'ME'], ['BBA', 'BB'], ['B.Sc', 'PH']];
const pad = (n, l = 3) => String(n).padStart(l, '0');

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, multipleStatements: true,
  });
  const dbName = process.env.DB_NAME || 'outpass_db';
  await c.query(fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8').replaceAll('outpass_db', dbName));

  const hash = {};
  for (const [r, p] of [['student', 'Student@123'], ['parent', 'Parent@123'], ['warden', 'Warden@123'], ['admin', 'Admin@123']])
    hash[r] = await bcrypt.hash(p, 10);
  const user = async (email, role, name, phone) =>
    (await c.query('INSERT INTO users (email,password_hash,role,full_name,phone_number) VALUES (?,?,?,?,?)',
      [email, hash[role], role, name, phone]))[0].insertId;

  await user('admin@example.com', 'admin', 'System Admin', '9000000000');

  // 8 girls' + 12 boys' blocks, one warden each (G1→Warden 1 … B12→Warden 20)
  const blocks = [];
  for (let i = 1; i <= 8; i++) blocks.push({ code: `G${i}`, g: 'F' });
  for (let i = 1; i <= 12; i++) blocks.push({ code: `B${i}`, g: 'M' });
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    b.id = (await c.query('INSERT INTO hostel_blocks (code,gender) VALUES (?,?)', [b.code, b.g]))[0].insertId;
    const n = i + 1;
    const uid = await user(`warden${pad(n)}@example.com`, 'warden', `Warden ${n} ${LAST[i % 10]}`, `91000${pad(n, 5)}`);
    await c.query('INSERT INTO wardens (user_id,employee_id,gender,designation,block_id) VALUES (?,?,?,?,?)',
      [uid, `EMP${pad(n)}`, b.g, 'Hostel Warden', b.id]);
  }

  const girls = blocks.filter((b) => b.g === 'F'), boys = blocks.filter((b) => b.g === 'M');
  const students = [];
  for (let i = 1; i <= 120; i++) {
    const female = i <= 60;
    const b = female ? girls[(i - 1) % 8] : boys[(i - 61) % 12];
    const first = (female ? FIRST_F : FIRST_M)[i % 10], last = LAST[Math.floor(i / 10) % 10];
    const pid = await user(`parent${pad(i)}@example.com`, 'parent', `${female ? 'Suresh' : 'Rajesh'} ${last}`, `9000${pad(i, 6)}`);
    await c.query('INSERT INTO parents (user_id,relationship,address) VALUES (?,?,?)', [pid, 'Father', `${i} Example Street, Sample City`]);
    const sid = await user(`student${pad(i)}@example.com`, 'student', `${first} ${last}`, `9100${pad(i, 6)}`);
    const [course, br] = BRANCHES[i % 5];
    await c.query(
      `INSERT INTO students (user_id,roll_number,gender,date_of_birth,course,branch,year_of_study,semester,block_id,room_number,parent_user_id,emergency_contact)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [sid, `MUJ2026${br}${pad(i)}`, female ? 'F' : 'M', '2006-05-15', course, br, (i % 4) + 1, ((i % 4) + 1) * 2 - 1,
        b.id, String(100 * ((i % 4) + 1) + (i % 30) + 1), pid, `9000${pad(i, 6)}`]);
    students.push({ sid, pid, b });
  }

  // Sample outpasses at various workflow stages
  const day = 86400000, now = Date.now();
  const samples = ['PENDING_PARENT_APPROVAL', 'PENDING_WARDEN_APPROVAL', 'APPROVED', 'PARENT_REJECTED', 'CHECKED_IN', 'WARDEN_REJECTED'];
  for (let i = 0; i < samples.length * 5; i++) {
    const s = students[i], st = samples[i % samples.length];
    const from = new Date(now + (i % 3 - 1) * day), until = new Date(+from + day);
    const [r] = await c.query(
      `INSERT INTO outpasses (student_id,type,from_at,until_at,expected_return_at,destination,purpose,description,status)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [s.sid, 'DAY_OUT', from, until, until, 'Sample City', 'Family visit', 'Synthetic seed request', st]);
    await c.query('INSERT INTO outpass_status_history (outpass_id,from_status,to_status,actor_id,note) VALUES (?,?,?,?,?)',
      [r.insertId, null, st, s.sid, 'Seeded sample']);
    await c.query('INSERT INTO notifications (user_id,type,message,outpass_id) VALUES (?,?,?,?)',
      [s.pid, 'NEW_REQUEST', 'Sample outpass request from your child.', r.insertId]);
  }
  console.log('Seed complete: 20 blocks, 20 wardens, 120 students, 120 parents, 30 outpasses.');
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
