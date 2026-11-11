import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Card } from '../../components/ui/card';
import { Page } from '../../components/ui/page';

export default function Revenue() {
  const { t } = useTranslation('boardman');
  const [transactions, setTransactions] = useState([]);

  useEffect(() => {
    api.get('/wallet/me/transactions').then((d) => setTransactions(d.transactions.filter((txn) => txn.type === 'COMMISSION')));
  }, []);

  const total = transactions.reduce((sum, txn) => sum + Number(txn.amount), 0);

  return (
    <>
      <TopBar title={t('revenue.title')} />
      <Page>
        <Card>
          <p className="text-sm text-muted">{t('revenue.totalEarned')}</p>
          <p className="text-[22px] font-bold">₦{total.toLocaleString()}</p>
        </Card>
        <h2>{t('revenue.history')}</h2>
        {transactions.length === 0 && <p className="text-sm text-muted">{t('revenue.none')}</p>}
        {transactions.map((txn) => (
          <Card key={txn.id}>
            <div className="flex justify-between">
              <span>{txn.note}</span>
              <strong>+₦{Number(txn.amount).toLocaleString()}</strong>
            </div>
            <p className="text-sm text-muted">{new Date(txn.createdAt).toLocaleString()}</p>
          </Card>
        ))}
      </Page>
      <BottomNav role="BOARDMAN" />
    </>
  );
}
