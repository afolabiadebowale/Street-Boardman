import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Page } from '../../components/ui/page';

export default function Deposit() {
  const { t } = useTranslation('better');
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
      setSuccess(t('deposit.added', { amount: Number(amount).toLocaleString() }));
      setTimeout(() => navigate('/better/wallet'), 1000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <TopBar title={t('deposit.title')} />
      <Page>
        <Card>
          <strong>{t('deposit.demoMode')}</strong>
          <p className="text-sm text-muted">{t('deposit.demoHint')}</p>
        </Card>
        {error && <div className="error-banner" role="alert">{error}</div>}
        {success && <div className="success-banner" role="status">{success}</div>}
        <form onSubmit={onSubmit}>
          <div className="mb-4">
            <Label htmlFor="deposit-amount">{t('deposit.amountLabel')}</Label>
            <Input id="deposit-amount" type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting ? t('deposit.processing') : t('deposit.submit')}
          </Button>
        </form>
      </Page>
      <BottomNav role="BETTER" />
    </>
  );
}
