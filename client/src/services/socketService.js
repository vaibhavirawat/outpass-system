import { io } from 'socket.io-client';
import { tokenStore } from './api';
export const connectSocket = () =>
  io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000', { auth: { token: tokenStore.get() } });
