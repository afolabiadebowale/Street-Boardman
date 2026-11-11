import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Card } from '../../components/ui/card';
import { Page } from '../../components/ui/page';

export default function Ledger() {
  const [transactions, setTransactions] = useState([]);

  useEffect(() => {
    api.get('/admin/ledger').then((d) => setTransactions(d.transactions));
  }, []);

  return (
    <>
      <TopBar title="Financial Ledger" />
      <Page>
        {transactions.map((t) => (
          <Card key={t.id}>
            <div className="flex justify-between">
              <span>{t.type.replace('_', ' ')}</span>
              <strong>{Number(t.amount) >= 0 ? '+' : ''}₦{Number(t.amount).toLocaleString()}</strong>
            </div>
            <p className="text-sm text-muted">{t.wallet.walletType} — {t.wallet.user?.fullName || 'Platform'}</p>
            <p className="text-sm text-muted">{new Date(t.createdAt).toLocaleString()}</p>
          </Card>
        ))}
      </Page>
      <BottomNav role="ADMIN" />
    </>
  );
}
