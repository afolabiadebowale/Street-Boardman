import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Page } from '../../components/ui/page';

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

  if (!overview) return <Page>Loading...</Page>;

  return (
    <>
      <TopBar title="Platform Overview" />
      <Page>
        <StaffSecurityBanner gate={user?.staffSecurity} />
        <Card>
          <p className="text-sm text-muted">Platform revenue (commission wallet)</p>
          <h1>₦{Number(overview.platformRevenue).toLocaleString()}</h1>
        </Card>
        <Card><span className="text-sm text-muted">Registered Betters</span><strong className="float-right">{overview.userCount}</strong></Card>
        <Card><span className="text-sm text-muted">Boardmen</span><strong className="float-right">{overview.boardmanCount}</strong></Card>
        <Card><span className="text-sm text-muted">Competitions</span><strong className="float-right">{overview.competitionCount}</strong></Card>
        <Card><span className="text-sm text-muted">Total bets placed</span><strong className="float-right">{overview.betCount}</strong></Card>

        <h2 className="mt-6">Manage</h2>
        <Button asChild variant="secondary"><Link to="/admin/users">Users</Link></Button>
        <Button asChild variant="secondary"><Link to="/admin/competitions">All Competitions</Link></Button>
        <Button asChild variant="secondary"><Link to="/admin/ledger">Financial Ledger</Link></Button>
        <Button asChild variant="secondary"><Link to="/admin/audit-logs">Audit Logs</Link></Button>
        <Button asChild variant="secondary"><Link to="/admin/security">Account Security</Link></Button>
      </Page>
      <BottomNav role="ADMIN" />
    </>
  );
}
