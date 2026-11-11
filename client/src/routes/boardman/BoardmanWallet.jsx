import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { cn } from '../../lib/utils';
import { Page } from '../../components/ui/page';

export default function BoardmanWallet() {
  const { t } = useTranslation('boardman');
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);

  useEffect(() => {
    api.get('/wallet/me').then((d) => setWallet(d.wallet));
    api.get('/wallet/me/transactions').then((d) => setTransactions(d.transactions.slice(0, 10)));
  }, []);

  return (
    <>
      <TopBar title={t('boardmanWallet.title')} />
      <Page>
        <Card>
          <p className="text-sm text-muted">{t('boardmanWallet.balance')}</p>
          <p className="text-[22px] font-bold">₦{wallet ? Number(wallet.balance).toLocaleString() : '...'}</p>
        </Card>
        <Button asChild variant="primary">
          <Link to="/boardman/withdraw">{t('boardmanWallet.withdraw')}</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link to="/boardman/revenue">{t('boardmanWallet.viewCommission')}</Link>
        </Button>

        <h2 className="mt-6">{t('boardmanWallet.recentActivity')}</h2>
        {transactions.map((txn) => (
          <Card key={txn.id}>
            <div className="flex justify-between">
              <span>{txn.type.replace('_', ' ')}</span>
              <strong className={cn(Number(txn.amount) >= 0 ? 'text-primary' : 'text-danger')}>
                {Number(txn.amount) >= 0 ? '+' : ''}₦{Number(txn.amount).toLocaleString()}
              </strong>
            </div>
            <p className="text-sm text-muted">{new Date(txn.createdAt).toLocaleString()}</p>
          </Card>
        ))}
      </Page>
      <BottomNav role="BOARDMAN" />
    </>
  );
}
