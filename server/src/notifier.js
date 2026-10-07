let io;
exports.setIo = (x) => { io = x; };
exports.send = async (c, userId, type, message, outpassId = null) => {
  if (!userId) return;
  const [r] = await c.query(
    'INSERT INTO notifications (user_id,type,message,outpass_id) VALUES (?,?,?,?)',
    [userId, type, message, outpassId]);
  if (io) io.to(`user:${userId}`).emit('notification', { id: r.insertId, type, message, outpass_id: outpassId });
};
exports.emit = (userId, event, payload) => { if (io) io.to(`user:${userId}`).emit(event, payload); };
exports.emitRoom = (room, event, payload) => { if (io) io.to(room).emit(event, payload); };
