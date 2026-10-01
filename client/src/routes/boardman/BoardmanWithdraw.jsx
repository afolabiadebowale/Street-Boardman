import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';

export default function BoardmanWithdraw() {
  const [amount, setAmount] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post('/withdrawals', {
        amount: Number(amount),
        pin,
        destination: { bankName, accountNumber, accountName },
      });
      setSuccess('Withdrawal requested. It will be processed shortly.');
      setTimeout(() => navigate('/boardman/wallet'), 1200);
    } catch (err) {
      setError(err.message);
      setPin('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <TopBar title="Withdraw Commission" />
      <div className="page">
        {error && <div className="error-banner">{error}</div>}
        {success && <div className="success-banner">{success}</div>}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label>Amount (₦)</label>
            <input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <div className="field">
            <label>Bank name</label>
            <input value={bankName} onChange={(e) => setBankName(e.target.value)} required />
          </div>
          <div className="field">
            <label>Account number</label>
            <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} required />
          </div>
          <div className="field">
            <label>Account name</label>
            <input value={accountName} onChange={(e) => setAccountName(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="withdraw-pin">Your PIN</label>
            <input id="withdraw-pin" type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)} required />
            <p className="muted">Re-enter your PIN to confirm. This keeps your money safe if someone else has your phone.</p>
          </div>
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? 'Requesting...' : 'Request Withdrawal'}
          </button>
        </form>
      </div>
      <BottomNav role="BOARDMAN" />
    </>
  );
}
