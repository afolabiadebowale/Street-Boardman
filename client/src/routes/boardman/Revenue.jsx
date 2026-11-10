import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Card } from '../../components/ui/card';

export default function Revenue() {
  const [transactions, setTransactions] = useState([]);

  useEffect(() => {
    api.get('/wallet/me/transactions').then((d) => setTransactions(d.transactions.filter((t) => t.type === 'COMMISSION')));
  }, []);

  const total = transactions.reduce((sum, t) => sum + Number(t.amount), 0);

  return (
    <>
      <TopBar title="Revenue & Commission" />
      <div className="px-4 pb-24 pt-4">
        <Card>
          <p className="text-sm text-muted">Total commission earned</p>
          <h1>₦{total.toLocaleString()}</h1>
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
      </div>
      <BottomNav role="BOARDMAN" />
    </>
  );
}
