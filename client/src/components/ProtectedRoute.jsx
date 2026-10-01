import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Frontend gate is purely for UX (don't show a Boardman screen to a
// Better) — the real permission check always happens again on the server,
// per the security architecture in docs/ARCHITECTURE.md section 11.
export default function ProtectedRoute({ role, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="page-loading">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to="/" replace />;

  // Once the staff security gate is live the server refuses every admin
  // action until MFA and a strong password are in place; send the admin
  // to the one page that can fix that instead of a wall of errors.
  const gate = user.staffSecurity;
  const gated = gate && gate.enforced && (gate.mfaRequired || gate.passwordChangeRequired);
  if (gated && location.pathname !== '/admin/security') return <Navigate to="/admin/security" replace />;

  return children;
}
