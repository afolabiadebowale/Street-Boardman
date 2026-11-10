import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

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
      <div className="px-4 pb-24 pt-4">
        {error && <div className="error-banner">{error}</div>}
        {success && <div className="success-banner">{success}</div>}
        <form onSubmit={onSubmit}>
          <div className="mb-4">
            <Label>Amount (₦)</Label>
            <Input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <div className="mb-4">
            <Label>Bank name</Label>
            <Input value={bankName} onChange={(e) => setBankName(e.target.value)} required />
          </div>
          <div className="mb-4">
            <Label>Account number</Label>
            <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} required />
          </div>
          <div className="mb-4">
            <Label>Account name</Label>
            <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} required />
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
      </div>
      <BottomNav role="BOARDMAN" />
    </>
  );
}
