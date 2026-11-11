import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Page } from '../../components/ui/page';

export default function BoardmanDashboard() {
  const { t } = useTranslation('boardman');
  const { user, boardmanProfile } = useAuth();
  const [wallet, setWallet] = useState(null);
  const [competitions, setCompetitions] = useState([]);

  useEffect(() => {
    api.get('/wallet/me').then((d) => setWallet(d.wallet));
    api.get('/competitions/mine/list').then((d) => setCompetitions(d.competitions));
  }, []);

  const isApproved = boardmanProfile?.approvalStatus === 'APPROVED';

  return (
    <>
      <TopBar title={t('dashboard.title')} />
      <Page>
        <h2>{t('dashboard.welcome', { name: user?.fullName })}</h2>

        {!isApproved && (
          <div className="error-banner" role="alert">
            {t('dashboard.notApproved', { status: boardmanProfile?.approvalStatus })}
          </div>
        )}

        <Card>
          <p className="text-sm text-muted">{t('dashboard.commissionBalance')}</p>
          <p className="text-[18px] font-bold">₦{wallet ? Number(wallet.balance).toLocaleString() : '...'}</p>
        </Card>

        <Button asChild variant="primary">
          <Link to="/boardman/create">{t('dashboard.createCompetition')}</Link>
        </Button>

        <h2 className="mt-6">{t('dashboard.yourCompetitions')}</h2>
        {competitions.length === 0 && <p className="text-sm text-muted">{t('dashboard.none')}</p>}
        {competitions.slice(0, 5).map((c) => (
          <Card key={c.id}>
            <div className="flex justify-between">
              <strong>{c.title}</strong>
              <Badge variant="open">{c.status.replace('_', ' ')}</Badge>
            </div>
            <p className="text-sm text-muted">{c.category}</p>
          </Card>
        ))}
        <Button asChild variant="secondary">
          <Link to="/boardman/active">{t('dashboard.manage')}</Link>
        </Button>
      </Page>
      <BottomNav role="BOARDMAN" />
    </>
  );
}
