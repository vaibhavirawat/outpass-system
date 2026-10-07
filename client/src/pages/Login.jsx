import { useState } from 'react';
import { useApp } from '../context/AuthContext';

const DEMO = [['Student', 'student001@example.com', 'Student@123'], ['Parent', 'parent001@example.com', 'Parent@123'],
  ['Warden', 'warden001@example.com', 'Warden@123'], ['Admin', 'admin@example.com', 'Admin@123']];

export default function Login() {
  const { login } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr('Enter a valid email address.');
    if (password.length < 6) return setErr('Password must be at least 6 characters.');
    setBusy(true); setErr('');
    try { await login(email, password); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  return (
    <div className="login">
      <section className="login-hero">
        <div className="crest big">🎓</div>
        <h1>Smart Hostel<br />Outpass System</h1>
        <p>Request, approve and track hostel outpasses, all in one place.</p>
        <ul>
          <li>✔ Parent and warden approval in real time</li>
          <li>✔ Digital check-out and check-in with full history</li>
          <li>✔ Instant alerts for overdue students</li>
          <li>✔ Parent–warden video calls</li>
        </ul>
      </section>
      <form className="login-card" onSubmit={submit}>
        <h2>Sign in</h2>
        <p className="muted">Use the account issued by your university.</p>
        <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" placeholder="you@example.com" /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="••••••••" /></label>
        {err && <div className="error">{err}</div>}
        <button className="btn primary wide" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="demo"><span className="muted">Dev credentials, click to fill:</span>
          <div>{DEMO.map(([r, e, p]) => <button type="button" key={r} className="chip" onClick={() => { setEmail(e); setPassword(p); }}>{r}</button>)}</div>
        </div>
      </form>
    </div>
  );
}
