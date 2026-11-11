import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Card } from '../../components/ui/card';
import { Page } from '../../components/ui/page';

export default function Revenue() {
  const [transactions, setTransactions] = useState([]);

  useEffect(() => {
    api.get('/wallet/me/transactions').then((d) => setTransactions(d.transactions.filter((t) => t.type === 'COMMISSION')));
  }, []);

  const total = transactions.reduce((sum, t) => sum + Number(t.amount), 0);

  return (
    <>
      <TopBar title="Revenue & Commission" />
      <Page>
        <Card>
          <p className="text-sm text-muted">Total commission earned</p>
          <p className="text-[22px] font-bold">₦{total.toLocaleString()}</p>
        </Card>
        <h2>Commission history</h2>
        {transactions.length === 0 && <p className="text-sm text-muted">No commission earned yet — it lands here once a competition is completed.</p>}
        {transactions.map((t) => (
          <Card key={t.id}>
            <div className="flex justify-between">
              <span>{t.note}</span>
              <strong>+₦{Number(t.amount).toLocaleString()}</strong>
            </div>
            <p className="text-sm text-muted">{new Date(t.createdAt).toLocaleString()}</p>
          </Card>
        ))}
      </Page>
      <BottomNav role="BOARDMAN" />
    </>
  );
}
