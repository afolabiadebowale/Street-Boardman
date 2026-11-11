import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Card } from '../../components/ui/card';
import { Page } from '../../components/ui/page';

export default function Ledger() {
  const { t } = useTranslation('admin');
  const [transactions, setTransactions] = useState([]);

  useEffect(() => {
    api.get('/admin/ledger').then((d) => setTransactions(d.transactions));
  }, []);

  return (
    <>
      <TopBar title={t('ledger.title')} />
      <Page>
        {transactions.map((txn) => (
          <Card key={txn.id}>
            <div className="flex justify-between">
              <span>{txn.type.replace('_', ' ')}</span>
              <strong>{Number(txn.amount) >= 0 ? '+' : ''}₦{Number(txn.amount).toLocaleString()}</strong>
            </div>
            <p className="text-sm text-muted">{txn.wallet.walletType} — {txn.wallet.user?.fullName || t('ledger.platform')}</p>
            <p className="text-sm text-muted">{new Date(txn.createdAt).toLocaleString()}</p>
          </Card>
        ))}
      </Page>
      <BottomNav role="ADMIN" />
    </>
  );
}
