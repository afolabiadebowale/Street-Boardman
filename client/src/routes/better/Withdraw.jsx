import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Page } from '../../components/ui/page';

export default function Withdraw() {
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
      setTimeout(() => navigate('/better/wallet'), 1200);
    } catch (err) {
      setError(err.message);
      setPin('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <TopBar title="Withdraw" />
      <Page>
        {error && <div className="error-banner" role="alert">{error}</div>}
        {success && <div className="success-banner" role="status">{success}</div>}
        <form onSubmit={onSubmit}>
          <div className="mb-4">
            <Label htmlFor="withdraw-amount">Amount (₦)</Label>
            <Input id="withdraw-amount" type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <div className="mb-4">
            <Label htmlFor="withdraw-bank-name">Bank name</Label>
            <Input id="withdraw-bank-name" value={bankName} onChange={(e) => setBankName(e.target.value)} required />
          </div>
          <div className="mb-4">
            <Label htmlFor="withdraw-account-number">Account number</Label>
            <Input id="withdraw-account-number" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} required />
          </div>
          <div className="mb-4">
            <Label htmlFor="withdraw-account-name">Account name</Label>
            <Input id="withdraw-account-name" value={accountName} onChange={(e) => setAccountName(e.target.value)} required />
          </div>
          <div className="mb-4">
            <Label htmlFor="withdraw-pin">Your PIN</Label>
            <Input id="withdraw-pin" type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)} required />
            <p className="text-sm text-muted">Re-enter your PIN to confirm. This keeps your money safe if someone else has your phone.</p>
          </div>
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting ? 'Requesting...' : 'Request Withdrawal'}
          </Button>
        </form>
      </Page>
      <BottomNav role="BETTER" />
    </>
  );
}
