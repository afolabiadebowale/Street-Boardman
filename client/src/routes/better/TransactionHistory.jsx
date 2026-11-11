import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { cn } from '../../lib/utils';
import { Page } from '../../components/ui/page';

// Server validates this is a real, already-started month (statementService.monthBounds)
// — so the picker can't default past that.
const currentMonth = new Date().toISOString().slice(0, 7);
// Same shape statementService.monthBounds requires server-side. Re-checked
// here (not just trusted from the <input type="month">) before building the
// download link, so the href is never built from unvalidated page state.
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export default function TransactionHistory() {
  const { t } = useTranslation('better');
  const [transactions, setTransactions] = useState([]);
  const [month, setMonth] = useState(currentMonth);
  const safeMonth = MONTH_PATTERN.test(month) ? month : currentMonth;

  useEffect(() => {
    api.get('/wallet/me/transactions').then((d) => setTransactions(d.transactions));
  }, []);

  return (
    <>
      <TopBar title={t('transactionHistory.title')} />
      <Page>
        <Card>
          <h2>{t('transactionHistory.downloadStatement')}</h2>
          <div className="mb-4">
            <Label htmlFor="statement-month">{t('transactionHistory.monthLabel')}</Label>
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
              {t('transactionHistory.downloadCsv')}
            </a>
          </Button>
        </Card>

        {transactions.length === 0 && <p className="text-sm text-muted">{t('transactionHistory.none')}</p>}
        {transactions.map((txn) => (
          <Card key={txn.id}>
            <div className="flex justify-between">
              <span>{txn.type.replace('_', ' ')}</span>
              <strong className={cn(Number(txn.amount) >= 0 ? 'text-primary' : 'text-danger')}>
                {Number(txn.amount) >= 0 ? '+' : ''}₦{Number(txn.amount).toLocaleString()}
              </strong>
            </div>
            <p className="text-sm text-muted">{t('transactionHistory.balanceAfter', { amount: Number(txn.balanceAfter).toLocaleString() })}</p>
            <p className="text-sm text-muted">{new Date(txn.createdAt).toLocaleString()}</p>
          </Card>
        ))}
      </Page>
      <BottomNav role="BETTER" />
    </>
  );
}
