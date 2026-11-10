import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

export default function Deposit() {
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post('/deposits/demo', { amount: Number(amount) });
      setSuccess(`₦${Number(amount).toLocaleString()} added to your wallet.`);
      setTimeout(() => navigate('/better/wallet'), 1000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <TopBar title="Deposit" />
      <div className="px-4 pb-24 pt-4">
        <Card>
          <strong>DEMO MODE</strong>
          <p className="text-sm text-muted">This adds test money to your wallet instantly. No real payment is taken.</p>
        </Card>
        {error && <div className="error-banner">{error}</div>}
        {success && <div className="success-banner">{success}</div>}
        <form onSubmit={onSubmit}>
          <div className="mb-4">
            <Label>Amount (₦)</Label>
            <Input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting ? 'Processing...' : 'Deposit'}
          </Button>
        </form>
      </div>
      <BottomNav role="BETTER" />
    </>
  );
}
