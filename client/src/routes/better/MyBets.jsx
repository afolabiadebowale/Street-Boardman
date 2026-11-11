import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Page } from '../../components/ui/page';

const STATUS_BADGE = {
  OPEN: 'pending',
  WON: 'won',
  LOST: 'lost',
  REFUNDED: 'closed',
  VOID: 'closed',
};

export default function MyBets() {
  const { t } = useTranslation('better');
  const [bets, setBets] = useState([]);

  useEffect(() => {
    api.get('/bets/me').then((d) => setBets(d.bets));
  }, []);

  return (
    <>
      <TopBar title={t('myBets.title')} />
      <Page>
        {bets.length === 0 && <p className="text-sm text-muted">{t('myBets.none')}</p>}
        {bets.map((bet) => (
          <Card key={bet.id} asChild className="text-inherit no-underline">
            <Link to={`/better/my-bets/${bet.betCode}`}>
              <div className="flex justify-between">
                <strong>{bet.betCode}</strong>
                <Badge variant={STATUS_BADGE[bet.status]}>{bet.status}</Badge>
              </div>
              <p className="text-sm text-muted">{bet.betOption.competition.title} — {bet.betOption.label}</p>
              <p>{t('myBets.stake', { amount: Number(bet.stake).toLocaleString() })}</p>
            </Link>
          </Card>
        ))}
      </Page>
      <BottomNav role="BETTER" />
    </>
  );
}
