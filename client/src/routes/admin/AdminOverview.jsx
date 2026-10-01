import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';

// During the grace period, says exactly what's missing and the date admin
// tools lock. After it, ProtectedRoute redirects to /admin/security instead.
function StaffSecurityBanner({ gate }) {
  if (!gate || (!gate.mfaRequired && !gate.passwordChangeRequired)) return null;
  const needs = [
    gate.mfaRequired && 'turn on two-factor authentication',
    gate.passwordChangeRequired && 'change to a password of at least 12 characters',
  ].filter(Boolean);
  const deadline = gate.enforcedFrom
    ? new Date(gate.enforcedFrom).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  return (
    <div className="error-banner">
      Please {needs.join(' and ')}.{deadline && ` Admin tools will be locked from ${deadline} until you do.`}{' '}
      <Link to="/admin/security">Account security</Link>
    </div>
  );
}

export default function AdminOverview() {
  const { user } = useAuth();
  const [overview, setOverview] = useState(null);

  useEffect(() => {
    api.get('/admin/overview').then(setOverview);
  }, []);

  if (!overview) return <div className="page">Loading...</div>;

  return (
    <>
      <TopBar title="Platform Overview" />
      <div className="page">
        <StaffSecurityBanner gate={user?.staffSecurity} />
        <div className="card">
          <p className="muted">Platform revenue (commission wallet)</p>
          <h1>₦{Number(overview.platformRevenue).toLocaleString()}</h1>
        </div>
        <div className="card"><span className="muted">Registered Betters</span><strong style={{ float: 'right' }}>{overview.userCount}</strong></div>
        <div className="card"><span className="muted">Boardmen</span><strong style={{ float: 'right' }}>{overview.boardmanCount}</strong></div>
        <div className="card"><span className="muted">Competitions</span><strong style={{ float: 'right' }}>{overview.competitionCount}</strong></div>
        <div className="card"><span className="muted">Total bets placed</span><strong style={{ float: 'right' }}>{overview.betCount}</strong></div>

        <h2 style={{ marginTop: 24 }}>Manage</h2>
        <Link to="/admin/users" className="btn btn-secondary">Users</Link>
        <Link to="/admin/competitions" className="btn btn-secondary">All Competitions</Link>
        <Link to="/admin/ledger" className="btn btn-secondary">Financial Ledger</Link>
        <Link to="/admin/audit-logs" className="btn btn-secondary">Audit Logs</Link>
        <Link to="/admin/security" className="btn btn-secondary">Account Security</Link>
      </div>
      <BottomNav role="ADMIN" />
    </>
  );
}
