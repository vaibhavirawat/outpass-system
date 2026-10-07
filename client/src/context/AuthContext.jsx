import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../components/ui';
import { api, tokenStore } from '../services/api';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!tokenStore.get());
  const [toasts, setToasts] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [incoming, setIncoming] = useState(null);
  const nav = useNavigate();

  const toast = useCallback((message, type = 'info') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const logout = useCallback(() => { tokenStore.clear(); setUser(null); setNotifications([]); }, []);
  const loadNotifications = useCallback(() =>
    api('/notifications').then((d) => setNotifications(d.notifications)).catch(() => {}), []);

  useEffect(() => {
    if (!tokenStore.get()) return;
    api('/auth/me').then((d) => setUser(d.user)).catch(() => tokenStore.clear()).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const h = () => { setUser(null); toast('Session expired. Please log in again.', 'error'); };
    window.addEventListener('auth-expired', h);
    return () => window.removeEventListener('auth-expired', h);
  }, [toast]);

  useEffect(() => {
    if (!user) return;
    loadNotifications();
    const s = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000', { auth: { token: tokenStore.get() } });
    s.on('notification', (n) => {
      setNotifications((l) => [{ ...n, is_read: 0, created_at: new Date().toISOString() }, ...l]);
      toast(n.message);
      window.dispatchEvent(new Event('outpass-updated'));
    });
    s.on('call:incoming', setIncoming);
    s.on('call:ended', (p) => setIncoming((c) => (c && c.call_id === p.call_id ? null : c)));
    return () => s.disconnect();
  }, [user, toast, loadNotifications]);

  const login = async (email, password) => {
    const d = await api('/auth/login', { method: 'POST', body: { email, password } });
    tokenStore.set(d.token); setUser(d.user);
  };
  const markRead = async (id) => {
    await api(`/notifications/${id}/read`, { method: 'PUT' });
    setNotifications((l) => l.map((n) => (n.id === id ? { ...n, is_read: 1 } : n)));
  };

  return (
    <Ctx.Provider value={{ user, loading, login, logout, toast, notifications, markRead }}>
      {children}
      {incoming && (
        <Modal title="📹 Video call request" onClose={() => {}}>
          <p>Warden <b>{incoming.from}</b> has requested a video call regarding <b>{incoming.student}</b>'s outpass request.</p>
          <div className="actions">
            <button className="btn primary" onClick={() => { const id = incoming.call_id; setIncoming(null); nav(`/call/${id}`); }}>Join Call</button>
            <button className="btn" onClick={async () => { const id = incoming.call_id; setIncoming(null); try { await api(`/video-calls/${id}/decline`, { method: 'POST' }); } catch (e) { toast(e.message, 'error'); } }}>Decline</button>
          </div>
        </Modal>
      )}
      <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>)}</div>
    </Ctx.Provider>
  );
}
