import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { useApp } from '../context/AuthContext';
import { StatusBadge, Empty, Spinner, fmt } from '../components/ui';

export function OutpassTable({ rows }) {
  const { user } = useApp();
  if (!rows.length) return <Empty text="No outpasses to show." />;
  return (
    <div className="table-wrap"><table>
      <thead><tr>{user.role !== 'student' && <th>Student</th>}<th>Destination</th><th>From</th><th>Until</th><th>Status</th><th /></tr></thead>
      <tbody>{rows.map((o) => (
        <tr key={o.id}>
          {user.role !== 'student' && <td>{o.student_name}<div className="muted">{o.roll_number} · {o.block}-{o.room_number}</div></td>}
          <td>{o.destination}<div className="muted">{o.type.replace('_', ' ')}</div></td>
          <td>{fmt(o.from_at)}</td><td>{fmt(o.until_at)}</td>
          <td><StatusBadge status={o.status} /></td>
          <td><Link className="btn small" to={`/outpasses/${o.id}`}>View</Link></td>
        </tr>))}</tbody>
    </table></div>
  );
}

const FILTERS = ['', 'PENDING_PARENT_APPROVAL', 'PENDING_WARDEN_APPROVAL', 'APPROVED', 'ACTIVE', 'CHECKED_IN', 'OVERDUE', 'PARENT_REJECTED', 'WARDEN_REJECTED'];

export default function OutpassList() {
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const load = useCallback(() => {
    const p = new URLSearchParams(); if (status) p.set('status', status); if (q) p.set('q', q);
    api(`/outpasses?${p}`).then((d) => setRows(d.outpasses)).catch(() => setRows([]));
  }, [status, q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { window.addEventListener('outpass-updated', load); return () => window.removeEventListener('outpass-updated', load); }, [load]);

  return (
    <>
      <h2>Outpasses</h2>
      <div className="filters">
        <input placeholder="Search name, roll, room, destination" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {FILTERS.map((s) => <option key={s} value={s}>{s ? s.replaceAll('_', ' ') : 'All statuses'}</option>)}
        </select>
      </div>
      <div className="card">{rows ? <OutpassTable rows={rows} /> : <Spinner />}</div>
    </>
  );
}
