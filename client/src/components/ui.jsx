export const fmt = (d) => d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const TONE = {
  PENDING_PARENT_APPROVAL: 'amber', PENDING_WARDEN_APPROVAL: 'amber', PARENT_APPROVED: 'blue',
  APPROVED: 'green', ACTIVE: 'blue', CHECKED_IN: 'green', OVERDUE: 'red',
  PARENT_REJECTED: 'red', WARDEN_REJECTED: 'red', CANCELLED: 'grey', EXPIRED: 'grey',
};
export const StatusBadge = ({ status }) =>
  <span className={`badge ${TONE[status] || 'grey'}`}>{status.replaceAll('_', ' ')}</span>;

export const Timeline = ({ items }) => (
  <ol className="timeline">
    {items.map((t) => (
      <li key={t.id}>
        <div className="dot" />
        <div><strong>{t.to_status.replaceAll('_', ' ')}</strong>
          <div className="muted">{fmt(t.created_at)}{t.actor ? ` · ${t.actor}` : ' · System'}</div>
          {t.note && <div>{t.note}</div>}</div>
      </li>
    ))}
  </ol>
);

export const Empty = ({ text }) => <div className="empty">{text}</div>;
export const Spinner = () => <div className="empty">Loading…</div>;

export function Modal({ title, children, onClose }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>{children}
      </div>
    </div>
  );
}
