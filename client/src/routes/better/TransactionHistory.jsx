import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { cn } from '../../lib/utils';

// Server validates this is a real, already-started month (statementService.monthBounds)
// — so the picker can't default past that.
const currentMonth = new Date().toISOString().slice(0, 7);
// Same shape statementService.monthBounds requires server-side. Re-checked
// here (not just trusted from the <input type="month">) before building the
// download link, so the href is never built from unvalidated page state.
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export default function TransactionHistory() {
  const [transactions, setTransactions] = useState([]);
  const [month, setMonth] = useState(currentMonth);
  const safeMonth = MONTH_PATTERN.test(month) ? month : currentMonth;

  useEffect(() => {
    api.get('/wallet/me/transactions').then((d) => setTransactions(d.transactions));
  }, []);

  return (
    <>
      <TopBar title="Transaction History" />
      <div className="px-4 pb-24 pt-4">
        <Card>
          <h2>Download a statement</h2>
          <div className="mb-4">
            <Label htmlFor="statement-month">Month</Label>
            <Input
              id="statement-month"
              type="month"
              value={month}
              max={currentMonth}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          <Button asChild variant="secondary">
            <a
              href={`/api/wallet/me/statement?month=${encodeURIComponent(safeMonth)}`}
              download={`streetboardman-statement-${safeMonth}.csv`}
            >
              Download CSV
            </a>
          </Button>
        </Card>

        {transactions.length === 0 && <p className="text-sm text-muted">No transactions yet.</p>}
        {transactions.map((t) => (
          <Card key={t.id}>
            <div className="flex justify-between">
              <span>{t.type.replace('_', ' ')}</span>
              <strong className={cn(Number(t.amount) >= 0 ? 'text-primary' : 'text-danger')}>
                {Number(t.amount) >= 0 ? '+' : ''}₦{Number(t.amount).toLocaleString()}
              </strong>
            </div>
            <p className="text-sm text-muted">Balance after: ₦{Number(t.balanceAfter).toLocaleString()}</p>
            <p className="text-sm text-muted">{new Date(t.createdAt).toLocaleString()}</p>
          </Card>
        ))}
      </div>
      <BottomNav role="BETTER" />
    </>
  );
}
