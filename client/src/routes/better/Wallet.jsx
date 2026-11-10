import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { cn } from '../../lib/utils';

export default function Wallet() {
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);

  useEffect(() => {
    api.get('/wallet/me').then((d) => setWallet(d.wallet));
    api.get('/wallet/me/transactions').then((d) => setTransactions(d.transactions.slice(0, 10)));
  }, []);

  return (
    <>
      <TopBar title="Wallet" />
      <div className="px-4 pb-24 pt-4">
        <Card>
          <p className="text-sm text-muted">Balance</p>
          <h1>₦{wallet ? Number(wallet.balance).toLocaleString() : '...'}</h1>
        </Card>
        <Button asChild variant="primary"><Link to="/better/deposit">Deposit</Link></Button>
        <Button asChild variant="secondary"><Link to="/better/withdraw">Withdraw</Link></Button>

        <h2 className="mt-6">Recent activity</h2>
        {transactions.map((t) => (
          <Card key={t.id}>
            <div className="flex justify-between">
              <span>{t.type.replace('_', ' ')}</span>
              <strong className={cn(Number(t.amount) >= 0 ? 'text-primary' : 'text-danger')}>
                {Number(t.amount) >= 0 ? '+' : ''}₦{Number(t.amount).toLocaleString()}
              </strong>
            </div>
            <p className="text-sm text-muted">{new Date(t.createdAt).toLocaleString()}</p>
          </Card>
        ))}
        <Button asChild variant="secondary"><Link to="/better/transactions">Full transaction history</Link></Button>
      </div>
      <BottomNav role="BETTER" />
    </>
  );
}
