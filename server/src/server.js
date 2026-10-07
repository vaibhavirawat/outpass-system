require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cron = require('node-cron');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const routes = require('./routes');
const wf = require('./workflow');
const notifier = require('./notifier');

for (const k of ['JWT_SECRET', 'DB_NAME']) if (!process.env[k]) { console.error(`Missing env var ${k}. Copy .env.example to .env`); process.exit(1); }

const app = express();
const origin = process.env.CLIENT_ORIGIN || 'http://localhost:3000';
app.use(helmet());
app.use(cors({ origin }));
app.use(express.json({ limit: '1mb' }));
app.get('/api/health', (req, res) => res.json({ success: true }));
app.use('/api/admin', require('./admin'));
app.use('/api/video-calls', require('./videoCalls'));
app.use('/api', routes);
app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found.' }));
app.use((err, req, res, next) => {
  if (err.code === 'ER_DUP_ENTRY') err = { status: 409, message: 'Duplicate value (email, roll number, employee ID or block code already exists).' };
  if (err.code === 'ER_NO_REFERENCED_ROW_2') err = { status: 400, message: 'Invalid reference to a related record.' };
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ success: false, message: status === 500 ? 'Internal server error.' : err.message });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin } });
io.use((socket, next) => {
  try { socket.user = jwt.verify(socket.handshake.auth.token, process.env.JWT_SECRET); next(); }
  catch { next(new Error('unauthorized')); }
});
io.on('connection', (s) => s.join(`user:${s.user.id}`));
notifier.setIo(io);
require('./callSignaling')(io);

if (require.main === module) {
  cron.schedule('* * * * *', () => wf.runOverdueJob().catch((e) => console.error('overdue job', e.message)));
  const port = process.env.PORT || 5000;
  server.listen(port, () => console.log(`API running on http://localhost:${port}`));
}
module.exports = { app, server };
