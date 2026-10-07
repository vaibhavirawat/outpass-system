import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AuthContext';

const NAV = {
  student: [['/', 'Dashboard', '🏠'], ['/apply', 'Apply Outpass', '📝'], ['/outpasses', 'My Outpasses', '🎫'], ['/notifications', 'Notifications', '🔔']],
  parent: [['/', 'Dashboard', '🏠'], ['/outpasses', 'Outpass Requests', '🎫'], ['/notifications', 'Notifications', '🔔']],
  warden: [['/', 'Dashboard', '🏠'], ['/outpasses', 'All Requests', '🎫'], ['/notifications', 'Notifications', '🔔']],
  admin: [['/', 'Dashboard', '🏠'], ['/admin', 'Manage System', '⚙️'], ['/outpasses', 'All Outpasses', '🎫'], ['/notifications', 'Notifications', '🔔']],
};

export default function Layout() {
  const { user, logout, notifications } = useApp();
  const nav = useNavigate();
  const unread = notifications.filter((n) => !n.is_read).length;
  const initials = user.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="crest">🎓</span><div>Hostel Outpass<small>University Portal</small></div></div>
        <nav>{NAV[user.role].map(([to, label, icon]) =>
          <NavLink key={to} to={to} end={to === '/'}><span className="ico">{icon}</span>{label}</NavLink>)}</nav>
        <div className="me">
          <div className="avatar">{initials}</div>
          <div className="who"><b>{user.full_name}</b><span>{user.role}</span></div>
        </div>
        <button className="logout" onClick={logout}>Sign out</button>
      </aside>
      <main>
        <header className="topbar">
          <div className="hello">Welcome back, <strong>{user.full_name.split(' ')[0]}</strong></div>
          <button className="bell" onClick={() => nav('/notifications')} aria-label="Notifications">🔔{unread > 0 && <b>{unread}</b>}</button>
        </header>
        <div className="content"><Outlet /></div>
      </main>
    </div>
  );
}
