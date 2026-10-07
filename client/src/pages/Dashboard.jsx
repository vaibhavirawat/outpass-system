import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { useApp } from '../context/AuthContext';
import { OutpassTable } from './OutpassList';
import { Spinner, fmt } from '../components/ui';

const Stat = ({ label, value, tone }) => <div className={`stat ${tone || ''}`}><div className="n">{value}</div><div>{label}</div></div>;

export default function Dashboard() {
  const { user } = useApp();
  const [rows, setRows] = useState(null);
  const [w, setW] = useState(null);
  const load = useCallback(() => {
    api('/outpasses').then((d) => setRows(d.outpasses));
    if (user.role === 'warden') api('/warden/dashboard').then(setW).catch(() => {});
  }, [user.role]);
  useEffect(() => { load(); window.addEventListener('outpass-updated', load); return () => window.removeEventListener('outpass-updated', load); }, [load]);
  if (!rows) return <Spinner />;

  const n = (...s) => rows.filter((o) => s.includes(o.status)).length;
  const active = rows.find((o) => ['ACTIVE', 'OVERDUE', 'APPROVED'].includes(o.status));

  return (
    <>
      <h2>{user.role === 'warden' && w ? `${w.block} Warden Dashboard` : `Welcome, ${user.full_name}`}</h2>

      {user.role === 'student' && (<>
        <div className="stats">
          <Stat label="Pending" value={n('PENDING_PARENT_APPROVAL', 'PENDING_WARDEN_APPROVAL')} tone="amber" />
          <Stat label="Approved" value={n('APPROVED')} tone="green" />
          <Stat label="Rejected" value={n('PARENT_REJECTED', 'WARDEN_REJECTED')} tone="red" />
          <Stat label="Checked in" value={n('CHECKED_IN')} />
        </div>
        {active && <div className="card highlight"><h3>Current outpass</h3>
          <p>{active.destination} · {fmt(active.from_at)} → {fmt(active.until_at)}</p>
          <Link className="btn primary" to={`/outpasses/${active.id}`}>Open / Check in-out</Link></div>}
        <Link className="btn primary" to="/apply">+ Apply for outpass</Link>
      </>)}

      {user.role === 'parent' && (<>
        <div className="stats">
          <Stat label="Awaiting your decision" value={n('PENDING_PARENT_APPROVAL')} tone="amber" />
          <Stat label="Approved" value={n('APPROVED', 'PENDING_WARDEN_APPROVAL')} tone="green" />
          <Stat label="Currently outside" value={n('ACTIVE', 'OVERDUE')} tone="blue" />
          <Stat label="Total" value={rows.length} />
        </div>
        {n('PENDING_PARENT_APPROVAL') > 0 && <div className="banner">You have requests waiting for your decision.</div>}
      </>)}

      {user.role === 'warden' && w && (<>
        <div className="stats">
          <Stat label="Total students" value={w.total_students} />
          <Stat label="Pending approval" value={n('PENDING_WARDEN_APPROVAL')} tone="amber" />
          <Stat label="Currently outside" value={n('ACTIVE', 'OVERDUE')} tone="blue" />
          <Stat label="Overdue" value={w.overdue.length} tone="red" />
        </div>
        {w.overdue.length > 0 && <div className="card alert"><h3>⚠ Overdue students</h3>
          {w.overdue.map((o) => <div key={o.id}><Link to={`/outpasses/${o.id}`}>{o.full_name}</Link> (room {o.room_number}) — due {fmt(o.expected_return_at)}</div>)}</div>}
        <div className="card"><h3>This month</h3>
          {(() => { const max = Math.max(1, ...w.status_counts_this_month.map((c) => c.n));
            return w.status_counts_this_month.map((c) => (
              <div className="bar-row" key={c.status}><span>{c.status.replaceAll('_', ' ')}</span>
                <div className="bar"><div style={{ width: `${(c.n / max) * 100}%` }} /></div><b>{c.n}</b></div>)); })()}
          <p className="muted">Average warden approval time: {w.avg_approval_minutes != null ? `${Math.round(w.avg_approval_minutes)} min` : 'n/a'}</p></div>
      </>)}

      {user.role === 'admin' && <div className="stats"><Stat label="Total outpasses" value={rows.length} /><Stat label="Active" value={n('ACTIVE')} tone="blue" /><Stat label="Overdue" value={n('OVERDUE')} tone="red" /></div>}

      <div className="card"><h3>Recent outpasses</h3><OutpassTable rows={rows.slice(0, 6)} /></div>
    </>
  );
}
