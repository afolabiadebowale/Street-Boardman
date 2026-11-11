import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Page } from '../../components/ui/page';

export default function BetterHome() {
  const { t } = useTranslation('better');
  const { user } = useAuth();
  const [wallet, setWallet] = useState(null);
  const [competitions, setCompetitions] = useState([]);

  useEffect(() => {
    api.get('/wallet/me').then((d) => setWallet(d.wallet));
    api.get('/competitions').then((d) => setCompetitions(d.competitions.slice(0, 3)));
  }, []);

  return (
    <>
      <TopBar title={t('home.title')} />
      <Page>
        <h2>{t('home.welcome', { name: user?.fullName })}</h2>

        <Card>
          <p className="text-sm text-muted">{t('home.walletBalance')}</p>
          <p className="text-[18px] font-bold">₦{wallet ? Number(wallet.balance).toLocaleString() : '...'}</p>
          <Button asChild variant="primary" className="mt-2">
            <Link to="/better/deposit">{t('home.deposit')}</Link>
          </Button>
        </Card>

        <h2>{t('home.openCompetitions')}</h2>
        {competitions.length === 0 && <p className="text-sm text-muted">{t('home.noneOpen')}</p>}
        {competitions.map((c) => (
          <Card key={c.id} asChild className="text-inherit no-underline">
            <Link to={`/better/competitions/${c.id}`}>
              <strong>{c.title}</strong>
              <p className="text-sm text-muted">{t('home.bettingCloses', { category: c.category, date: new Date(c.bettingDeadline).toLocaleString() })}</p>
            </Link>
          </Card>
        ))}
        <Button asChild variant="secondary">
          <Link to="/better/competitions">{t('home.seeAll')}</Link>
        </Button>
      </Page>
      <BottomNav role="BETTER" />
    </>
  );
}
