import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useApp } from '../context/AuthContext';
import { fmt } from '../components/ui';

const init = { type: 'DAY_OUT', from_at: '', until_at: '', expected_return_at: '', destination: '', purpose: '', description: '', emergency_contact: '' };

export default function ApplyOutpass() {
  const [f, setF] = useState(init);
  const [step, setStep] = useState('form');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const { toast } = useApp();
  const nav = useNavigate();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const review = (e) => {
    e.preventDefault();
    if (!f.from_at || !f.until_at || !f.destination.trim() || !f.purpose.trim()) return setErr('Fill in all required fields.');
    if (new Date(f.until_at) <= new Date(f.from_at)) return setErr('Until must be after From.');
    if (new Date(f.until_at) < new Date()) return setErr('The outpass period has already passed.');
    if (f.emergency_contact && !/^\d{10}$/.test(f.emergency_contact)) return setErr('Emergency contact must be 10 digits.');
    setErr(''); setStep('confirm');
  };
  const submit = async () => {
    setBusy(true);
    try {
      const iso = (v) => (v ? new Date(v).toISOString() : undefined);
      const { id } = await api('/outpasses', { method: 'POST', body: { ...f, from_at: iso(f.from_at), until_at: iso(f.until_at), expected_return_at: iso(f.expected_return_at) } });
      toast('Outpass submitted to your parent for approval.', 'success'); nav(`/outpasses/${id}`);
    } catch (x) { setErr(x.message); setStep('form'); } finally { setBusy(false); }
  };

  if (step === 'confirm') return (
    <div className="card narrow"><h2>Confirm your request</h2>
      <dl>{[['Type', f.type.replace('_', ' ')], ['From', fmt(f.from_at)], ['Until', fmt(f.until_at)], ['Destination', f.destination], ['Purpose', f.purpose], ['Description', f.description || '—']]
        .map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <p className="muted">This goes to your parent first, then to your block warden.</p>
      <button className="btn" onClick={() => setStep('form')}>Edit</button>{' '}
      <button className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit request'}</button>
    </div>);

  return (
    <form className="card narrow" onSubmit={review}>
      <h2>Apply for outpass</h2>
      <label>Type<select value={f.type} onChange={set('type')}>
        {['DAY_OUT', 'OVERNIGHT', 'EMERGENCY', 'WEEKEND'].map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}</select></label>
      <div className="row"><label>From *<input type="datetime-local" value={f.from_at} onChange={set('from_at')} /></label>
        <label>Until *<input type="datetime-local" value={f.until_at} onChange={set('until_at')} /></label></div>
      <label>Expected return (defaults to Until)<input type="datetime-local" value={f.expected_return_at} onChange={set('expected_return_at')} /></label>
      <label>Destination *<input value={f.destination} onChange={set('destination')} /></label>
      <label>Purpose *<input value={f.purpose} onChange={set('purpose')} /></label>
      <label>Description<textarea rows="3" value={f.description} onChange={set('description')} /></label>
      <label>Emergency contact<input value={f.emergency_contact} onChange={set('emergency_contact')} placeholder="10-digit number" /></label>
      {err && <div className="error">{err}</div>}
      <button className="btn primary">Review</button>
    </form>);
}
