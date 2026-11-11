import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('admin');
  if (!gate || (!gate.mfaRequired && !gate.passwordChangeRequired)) return null;
  const needs = [
    gate.mfaRequired && t('overview.securityBanner.mfaAction'),
    gate.passwordChangeRequired && t('overview.securityBanner.passwordAction'),
  ].filter(Boolean);
  const deadline = gate.enforcedFrom
    ? new Date(gate.enforcedFrom).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  return (
    <div className="error-banner" role="alert">
      {t('overview.securityBanner.prefix', { actions: needs.join(' and ') })}
      {deadline && t('overview.securityBanner.lockedSuffix', { date: deadline })}{' '}
      <Link to="/admin/security">{t('overview.securityBanner.accountSecurity')}</Link>
    </div>
  );
}

export default function AdminOverview() {
  const { t } = useTranslation('admin');
  const { user } = useAuth();
  const [overview, setOverview] = useState(null);

  useEffect(() => {
    api.get('/admin/overview').then(setOverview);
  }, []);

  if (!overview) return <Page role="status">Loading...</Page>;

  return (
    <>
      <TopBar title={t('overview.title')} />
      <Page>
        <StaffSecurityBanner gate={user?.staffSecurity} />
        <Card>
          <p className="text-sm text-muted">{t('overview.platformRevenue')}</p>
          <p className="text-[22px] font-bold">₦{Number(overview.platformRevenue).toLocaleString()}</p>
        </Card>
        <Card><span className="text-sm text-muted">{t('overview.registeredBetters')}</span><strong className="float-right">{overview.userCount}</strong></Card>
        <Card><span className="text-sm text-muted">{t('overview.boardmen')}</span><strong className="float-right">{overview.boardmanCount}</strong></Card>
        <Card><span className="text-sm text-muted">{t('overview.competitions')}</span><strong className="float-right">{overview.competitionCount}</strong></Card>
        <Card><span className="text-sm text-muted">{t('overview.totalBets')}</span><strong className="float-right">{overview.betCount}</strong></Card>

        <h2 className="mt-6">{t('overview.manage')}</h2>
        <Button asChild variant="secondary"><Link to="/admin/users">{t('overview.users')}</Link></Button>
        <Button asChild variant="secondary"><Link to="/admin/competitions">{t('overview.allCompetitions')}</Link></Button>
        <Button asChild variant="secondary"><Link to="/admin/ledger">{t('overview.financialLedger')}</Link></Button>
        <Button asChild variant="secondary"><Link to="/admin/audit-logs">{t('overview.auditLogs')}</Link></Button>
        <Button asChild variant="secondary"><Link to="/admin/security">{t('overview.accountSecurity')}</Link></Button>
      </Page>
      <BottomNav role="ADMIN" />
    </>
  );
}
