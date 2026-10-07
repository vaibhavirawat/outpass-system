const BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
export const tokenStore = {
  get: () => sessionStorage.getItem('token'),
  set: (t) => sessionStorage.setItem('token', t),
  clear: () => sessionStorage.removeItem('token'),
};
export async function api(path, { method = 'GET', body } = {}) {
  const t = tokenStore.get();
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && t) { tokenStore.clear(); window.dispatchEvent(new Event('auth-expired')); }
  if (!res.ok) throw new Error(data.message || 'Request failed');
  return data;
}
