import { Link } from 'react-router-dom';
import { useApp } from '../context/AuthContext';
import { Empty, fmt } from '../components/ui';

export default function Notifications() {
  const { notifications, markRead } = useApp();
  return (
    <>
      <h2>Notifications</h2>
      <div className="card">
        {!notifications.length ? <Empty text="You're all caught up." /> : notifications.map((n) => (
          <div key={n.id} className={`note ${n.is_read ? '' : 'unread'}`} onClick={() => !n.is_read && markRead(n.id)}>
            <div>{n.message}</div>
            <div className="muted">{fmt(n.created_at)} {n.outpass_id && <Link to={`/outpasses/${n.outpass_id}`}>· View outpass</Link>}</div>
          </div>))}
      </div>
    </>
  );
}
