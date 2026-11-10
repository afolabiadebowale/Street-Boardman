import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';

// Server validates this is a real, already-started month (statementService.monthBounds)
// — so the picker can't default past that.
const currentMonth = new Date().toISOString().slice(0, 7);

export default function TransactionHistory() {
  const [transactions, setTransactions] = useState([]);
  const [month, setMonth] = useState(currentMonth);

  useEffect(() => {
    api.get('/wallet/me/transactions').then((d) => setTransactions(d.transactions));
  }, []);

  return (
    <>
      <TopBar title="Transaction History" />
      <div className="page">
        <div className="card">
          <h2>Download a statement</h2>
          <div className="field">
            <label htmlFor="statement-month">Month</label>
            <input
              id="statement-month"
              type="month"
              value={month}
              max={currentMonth}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          <a
            href={`/api/wallet/me/statement?month=${month}`}
            download={`streetboardman-statement-${month}.csv`}
            className="btn btn-secondary"
          >
            Download CSV
          </a>
        </div>

        {transactions.length === 0 && <p className="muted">No transactions yet.</p>}
        {transactions.map((t) => (
          <div key={t.id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{t.type.replace('_', ' ')}</span>
              <strong style={{ color: Number(t.amount) >= 0 ? 'var(--color-primary)' : 'var(--color-danger)' }}>
                {Number(t.amount) >= 0 ? '+' : ''}₦{Number(t.amount).toLocaleString()}
              </strong>
            </div>
            <p className="muted">Balance after: ₦{Number(t.balanceAfter).toLocaleString()}</p>
            <p className="muted">{new Date(t.createdAt).toLocaleString()}</p>
          </div>
        ))}
      </div>
      <BottomNav role="BETTER" />
    </>
  );
}
