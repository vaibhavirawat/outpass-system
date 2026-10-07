const db = require('./db');

// WebRTC signaling only relays SDP/ICE between the two authorised participants; media flows peer-to-peer.
module.exports = (io) => {
  io.on('connection', (socket) => {
    socket.on('call:join', async ({ callId }) => {
      try {
        const [r] = await db.query(
          'SELECT v.warden_id, v.parent_id, v.status, u.full_name FROM video_calls v JOIN users u ON u.id=? WHERE v.id=?',
          [socket.user.id, callId]);
        const c = r[0];
        if (!c || ![c.warden_id, c.parent_id].includes(socket.user.id) || ['DECLINED', 'ENDED'].includes(c.status)) return;
        socket.join(`call:${callId}`);
        socket.to(`call:${callId}`).emit('call:peer-joined', { userId: socket.user.id, name: c.full_name });
      } catch (e) { console.error('call:join', e.message); }
    });
    socket.on('call:signal', ({ callId, data }) => {
      if (socket.rooms.has(`call:${callId}`)) socket.to(`call:${callId}`).emit('call:signal', { data });
    });
    socket.on('disconnecting', () => {
      for (const room of socket.rooms) if (room.startsWith('call:')) socket.to(room).emit('call:peer-left');
    });
  });
};
