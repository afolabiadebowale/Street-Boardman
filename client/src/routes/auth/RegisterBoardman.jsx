import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Page } from '../../components/ui/page';

export default function RegisterBoardman() {
  const { t } = useTranslation('auth');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [businessLocation, setBusinessLocation] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { refresh } = useAuth();
  const navigate = useNavigate();

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await api.post('/auth/register/boardman', { fullName, phone, pin, businessLocation });
      setMessage(res.message);
      await refresh();
      setTimeout(() => navigate('/boardman'), 1200);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Page>
      <h1>{t('registerBoardman.title')}</h1>
      <p className="text-sm text-muted">
        {t('registerBoardman.notice')}
      </p>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {message && <div className="success-banner" role="status">{message}</div>}
      <form onSubmit={onSubmit}>
        <div className="mb-4">
          <Label htmlFor="reg-boardman-name">{t('registerBoardman.nameLabel')}</Label>
          <Input id="reg-boardman-name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required />
        </div>
        <div className="mb-4">
          <Label htmlFor="reg-boardman-phone">{t('registerBoardman.phoneLabel')}</Label>
          <Input id="reg-boardman-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" required />
        </div>
        <div className="mb-4">
          <Label htmlFor="reg-boardman-pin">{t('registerBoardman.pinLabel')}</Label>
          <Input id="reg-boardman-pin" value={pin} onChange={(e) => setPin(e.target.value)} type="password" autoComplete="new-password" required />
        </div>
        <div className="mb-4">
          <Label htmlFor="reg-boardman-location">{t('registerBoardman.locationLabel')}</Label>
          <Input
            id="reg-boardman-location"
            value={businessLocation}
            onChange={(e) => setBusinessLocation(e.target.value)}
            placeholder={t('registerBoardman.locationPlaceholder')}
            required
          />
        </div>
        <Button variant="primary" disabled={submitting} type="submit">
          {submitting ? t('registerBoardman.submitting') : t('registerBoardman.submit')}
        </Button>
      </form>
      <p className="text-sm text-muted">
        {t('registerBoardman.alreadyRegistered')} <Link to="/login">{t('registerBoardman.login')}</Link>
      </p>
    </Page>
  );
}
