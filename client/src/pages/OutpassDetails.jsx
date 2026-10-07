import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useApp } from '../context/AuthContext';
import { StatusBadge, Timeline, Modal, Spinner, fmt } from '../components/ui';

export default function OutpassDetails() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, toast } = useApp();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [reject, setReject] = useState(null); // endpoint prefix
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() =>
    api(`/outpasses/${id}`).then(setD).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); window.addEventListener('outpass-updated', load); return () => window.removeEventListener('outpass-updated', load); }, [load]);

  const run = async (path, method = 'POST', body) => {
    setBusy(true);
    try { await api(`/outpasses/${id}/${path}`, { method, body }); toast('Done.', 'success'); setReject(null); setReason(''); await load(); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  if (err) return <div className="error">{err}</div>;
  if (!d) return <Spinner />;
  const { outpass: o, timeline, records } = d;
  const s = o.status;
  const out = records.find((r) => r.kind === 'CHECK_OUT'), inn = records.find((r) => r.kind === 'CHECK_IN');

  return (
    <>
      <h2>Outpass #{o.id} <StatusBadge status={s} /></h2>
      <div className="grid2">
        <div className="card">
          <dl>
            {[['Student', `${o.student_name} (room ${o.room_number})`], ['Type', o.type.replace('_', ' ')], ['Destination', o.destination],
              ['From', fmt(o.from_at)], ['Until', fmt(o.until_at)], ['Expected return', fmt(o.expected_return_at)],
              ['Purpose', o.purpose], ['Description', o.description || '—'],
              ['Parent decision', s === 'PENDING_PARENT_APPROVAL' ? 'Pending' : o.parent_reason ? `Rejected: ${o.parent_reason}` : 'Approved'],
              ...(o.warden_reason ? [['Warden reason', o.warden_reason]] : []),
              ...(out ? [['Checked out', fmt(out.recorded_at)]] : []), ...(inn ? [['Checked in', fmt(inn.recorded_at)]] : [])]
              .map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
          <div className="actions">
            {user.role === 'student' && s === 'APPROVED' && <button className="btn primary" disabled={busy} onClick={() => run('check-out')}>Check Out</button>}
            {user.role === 'student' && ['ACTIVE', 'OVERDUE'].includes(s) && <button className="btn primary" disabled={busy} onClick={() => run('check-in')}>Check In</button>}
            {user.role === 'student' && ['PENDING_PARENT_APPROVAL', 'PENDING_WARDEN_APPROVAL', 'APPROVED'].includes(s) &&
              <button className="btn" disabled={busy} onClick={() => window.confirm('Cancel this outpass?') && run('cancel', 'PUT')}>Cancel request</button>}
            {user.role === 'parent' && s === 'PENDING_PARENT_APPROVAL' && <>
              <button className="btn primary" disabled={busy} onClick={() => run('parent-approve')}>Approve</button>
              <button className="btn danger" onClick={() => setReject('parent-reject')}>Reject</button></>}
            {user.role === 'warden' && s === 'PENDING_WARDEN_APPROVAL' && <>
              <button className="btn primary" disabled={busy} onClick={() => run('warden-approve')}>Approve</button>
              <button className="btn danger" onClick={() => setReject('warden-reject')}>Reject</button>
              <button className="btn" disabled={busy} onClick={async () => { try { const r = await api('/video-calls', { method: 'POST', body: { outpass_id: o.id } }); nav(`/call/${r.id}`); } catch (e) { toast(e.message, 'error'); } }}>📹 Request Parent Video Call</button></>}
          </div>
        </div>
        <div className="card"><h3>Timeline</h3><Timeline items={timeline} /></div>
      </div>
      {reject && <Modal title="Reason for rejection" onClose={() => setReject(null)}>
        <textarea rows="3" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Visible to the student" />
        <div className="actions"><button className="btn" onClick={() => setReject(null)}>Back</button>
          <button className="btn danger" disabled={!reason.trim() || busy} onClick={() => run(reject, 'POST', { reason })}>Confirm reject</button></div>
      </Modal>}
    </>
  );
}
