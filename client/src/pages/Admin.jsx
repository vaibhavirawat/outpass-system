import { useEffect, useState, useCallback } from 'react';
import { api } from '../services/api';
import { useApp } from '../context/AuthContext';
import { Modal, Empty, Spinner, fmt } from '../components/ui';

const GENDER = [{ value: 'F', label: 'Female' }, { value: 'M', label: 'Male' }];

function Crud({ path, cols, fields, onChange }) {
  const { toast } = useApp();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null); // {} = new
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api(`/admin/${path}?q=${encodeURIComponent(q)}`).then((d) => setRows(d.rows)).catch((e) => toast(e.message, 'error'));
  }, [path, q, toast]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const open = (row) => {
    const f = {}; fields.forEach((x) => { f[x.key] = row ? String(row[x.key] ?? '').slice(0, x.type === 'date' ? 10 : undefined) : ''; });
    setForm(f); setEdit(row || {});
  };
  const save = async () => {
    const editing = !!edit.id;
    const body = {};
    fields.forEach((x) => { if (editing && x.createOnly) return; if (form[x.key] !== '' || editing) body[x.key] = form[x.key]; });
    setBusy(true);
    try {
      await api(`/admin/${path}${editing ? `/${edit.id}` : ''}`, { method: editing ? 'PUT' : 'POST', body });
      toast(editing ? 'Updated.' : 'Created.', 'success'); setEdit(null); load(); onChange?.();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const toggle = async (r) => {
    const status = r.account_status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    if (!window.confirm(`${status === 'INACTIVE' ? 'Deactivate' : 'Activate'} ${r.full_name}?`)) return;
    try { await api(`/admin/users/${r.id}/status`, { method: 'PUT', body: { status } }); load(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="card">
      <div className="filters">
        {path !== 'blocks' && <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />}
        <button className="btn primary" onClick={() => open(null)}>+ Add</button>
      </div>
      {!rows ? <Spinner /> : !rows.length ? <Empty text="Nothing found." /> : (
        <div className="table-wrap"><table>
          <thead><tr>{cols.map(([l]) => <th key={l}>{l}</th>)}<th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className={r.account_status === 'INACTIVE' ? 'inactive' : ''}>
              {cols.map(([l, k]) => <td key={l}>{r[k] ?? '—'}</td>)}
              <td className="nowrap"><button className="btn small" onClick={() => open(r)}>Edit</button>{' '}
                {r.account_status && <button className="btn small" onClick={() => toggle(r)}>{r.account_status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</button>}</td>
            </tr>))}</tbody></table></div>)}
      {edit && (
        <Modal title={edit.id ? 'Edit' : 'Add new'} onClose={() => setEdit(null)}>
          <div className="formgrid">
            {fields.filter((x) => !(edit.id && x.createOnly)).map((x) => (
              <label key={x.key}>{x.label}{x.required && ' *'}
                {x.options ? (
                  <select value={form[x.key]} onChange={(e) => setForm({ ...form, [x.key]: e.target.value })}>
                    <option value="">Select…</option>{x.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                ) : <input type={x.type || 'text'} value={form[x.key]} onChange={(e) => setForm({ ...form, [x.key]: e.target.value })} />}
              </label>))}
          </div>
          <div className="actions"><button className="btn" onClick={() => setEdit(null)}>Cancel</button>
            <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></div>
        </Modal>)}
    </div>
  );
}

function Overview() {
  const [s, setS] = useState(null); const [logs, setLogs] = useState([]);
  useEffect(() => { api('/admin/summary').then((d) => setS(d.summary)); api('/admin/audit-logs').then((d) => setLogs(d.logs)); }, []);
  if (!s) return <Spinner />;
  return (<>
    <div className="stats">{Object.entries(s).map(([k, v]) => <div className="stat" key={k}><div className="n">{v}</div><div>{k}</div></div>)}</div>
    <div className="card"><h3>System activity</h3>
      <div className="table-wrap"><table><thead><tr><th>When</th><th>User</th><th>Action</th><th>Description</th></tr></thead>
        <tbody>{logs.map((l) => <tr key={l.id}><td>{fmt(l.created_at)}</td><td>{l.user_name || 'System'}</td><td>{l.action}</td><td>{l.description}</td></tr>)}</tbody></table></div></div>
  </>);
}

export default function Admin() {
  const [tab, setTab] = useState('overview');
  const [blocks, setBlocks] = useState([]); const [parents, setParents] = useState([]);
  const refs = useCallback(() => {
    api('/admin/blocks').then((d) => setBlocks(d.rows.map((b) => ({ value: b.id, label: `${b.code} (${b.gender === 'F' ? 'Girls' : 'Boys'})` }))));
    api('/admin/parents').then((d) => setParents(d.rows.map((p) => ({ value: p.id, label: `${p.full_name} · ${p.email}` }))));
  }, []);
  useEffect(() => { refs(); }, [refs]);

  const acct = [{ key: 'full_name', label: 'Full name', required: true }, { key: 'email', label: 'Email', type: 'email', createOnly: true, required: true },
    { key: 'password', label: 'Initial password', type: 'password', createOnly: true, required: true }, { key: 'phone_number', label: 'Phone' }];
  const TABS = {
    overview: <Overview />,
    students: <Crud key="s" path="students" onChange={refs}
      cols={[['Name', 'full_name'], ['Roll', 'roll_number'], ['Block', 'block'], ['Room', 'room_number'], ['Parent', 'parent_name'], ['Status', 'account_status']]}
      fields={[...acct, { key: 'roll_number', label: 'Roll number', createOnly: true, required: true }, { key: 'gender', label: 'Gender', options: GENDER, createOnly: true, required: true },
        { key: 'date_of_birth', label: 'Date of birth', type: 'date' }, { key: 'course', label: 'Course' }, { key: 'branch', label: 'Branch' },
        { key: 'year_of_study', label: 'Year', type: 'number' }, { key: 'semester', label: 'Semester', type: 'number' },
        { key: 'block_id', label: 'Hostel block', options: blocks, required: true }, { key: 'room_number', label: 'Room' },
        { key: 'parent_user_id', label: 'Parent', options: parents, required: true }, { key: 'emergency_contact', label: 'Emergency contact' }]} />,
    parents: <Crud key="p" path="parents" onChange={refs}
      cols={[['Name', 'full_name'], ['Email', 'email'], ['Relationship', 'relationship'], ['Children', 'children'], ['Status', 'account_status']]}
      fields={[...acct, { key: 'relationship', label: 'Relationship' }, { key: 'address', label: 'Address' }]} />,
    wardens: <Crud key="w" path="wardens"
      cols={[['Name', 'full_name'], ['Employee ID', 'employee_id'], ['Block', 'block'], ['Email', 'email'], ['Status', 'account_status']]}
      fields={[...acct, { key: 'employee_id', label: 'Employee ID', createOnly: true, required: true }, { key: 'gender', label: 'Gender', options: GENDER, createOnly: true, required: true },
        { key: 'designation', label: 'Designation' }, { key: 'block_id', label: 'Assigned block', options: blocks }]} />,
    blocks: <Crud key="b" path="blocks" onChange={refs}
      cols={[['Block', 'code'], ['Type', 'gender'], ['Warden', 'warden_name'], ['Students', 'student_count']]}
      fields={[{ key: 'code', label: 'Block code', required: true }, { key: 'gender', label: 'Type', options: GENDER, createOnly: true, required: true }]} />,
  };
  return (<>
    <h2>Administration</h2>
    <div className="tabs">{Object.keys(TABS).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
    {TABS[tab]}
  </>);
}
