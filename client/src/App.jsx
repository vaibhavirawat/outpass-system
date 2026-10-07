import { Routes, Route, Navigate } from 'react-router-dom';
import { useApp } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import OutpassList from './pages/OutpassList';
import ApplyOutpass from './pages/ApplyOutpass';
import OutpassDetails from './pages/OutpassDetails';
import VideoCall from './components/VideoCall';
import Admin from './pages/Admin';
import Notifications from './pages/Notifications';

const Guard = ({ roles, children }) => {
  const { user } = useApp();
  return roles.includes(user.role) ? children : <Navigate to="/" replace />;
};

export default function App() {
  const { user, loading } = useApp();
  if (loading) return <div className="empty">Loading…</div>;
  if (!user) return <Routes><Route path="*" element={<Login />} /></Routes>;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="outpasses" element={<OutpassList />} />
        <Route path="outpasses/:id" element={<OutpassDetails />} />
        <Route path="apply" element={<Guard roles={['student']}><ApplyOutpass /></Guard>} />
        <Route path="call/:id" element={<Guard roles={['warden', 'parent']}><VideoCall /></Guard>} />
        <Route path="admin" element={<Guard roles={['admin']}><Admin /></Guard>} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
