import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Page } from '../../components/ui/page';

function homeFor(role) {
  if (role === 'ADMIN') return '/admin';
  if (role === 'BOARDMAN') return '/boardman';
  return '/better';
}

export default function Login() {
  const { t } = useTranslation('auth');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  // Set when the server says this account needs a second factor (TASK-031):
  // a short-lived token proving the PIN step passed, not a session.
  const [mfaToken, setMfaToken] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { refresh } = useAuth();
  const navigate = useNavigate();

  const finishLogin = async (user) => {
    await refresh();
    navigate(homeFor(user.role));
  };

  const onSubmitPin = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const data = await api.post('/auth/login', { phone, pin });
      if (data.mfaRequired) {
        setMfaToken(data.mfaToken);
        setPin('');
        return;
      }
      await finishLogin(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmitCode = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { user } = await api.post('/auth/mfa/verify', { mfaToken, code });
      await finishLogin(user);
    } catch (err) {
      // The challenge token expires after a few minutes; past that the only
      // way forward is entering the PIN again.
      if (/expired/i.test(err.message)) setMfaToken(null);
      // A rejected code is useless; clearing it saves backspacing six
      // digits on a phone keypad before retrying.
      setCode('');
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const startOver = () => {
    setMfaToken(null);
    setCode('');
    setError('');
  };

  if (mfaToken) {
    return (
      <Page>
        <h1>{t('login.mfaTitle')}</h1>
        <p className="text-sm text-muted">{t('login.mfaHint')}</p>
        {error && <div className="error-banner" role="alert">{error}</div>}
        <form onSubmit={onSubmitCode}>
          <div className="mb-4">
            <Label htmlFor="mfa-code">{t('login.codeLabel')}</Label>
            <Input
              id="mfa-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              autoFocus
              required
            />
          </div>
          <Button variant="primary" disabled={submitting || code.length !== 6} type="submit">
            {submitting ? t('login.verifying') : t('login.verify')}
          </Button>
        </form>
        <p className="text-sm text-muted">
          <Button type="button" variant="secondary" onClick={startOver}>
            {t('login.backToLogin')}
          </Button>
        </p>
      </Page>
    );
  }

  return (
    <Page>
      <h1>{t('login.title')}</h1>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <form onSubmit={onSubmitPin}>
        <div className="mb-4">
          <Label htmlFor="login-phone">{t('login.phoneLabel')}</Label>
          <Input id="login-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" required />
        </div>
        <div className="mb-4">
          <Label htmlFor="login-pin">{t('login.pinLabel')}</Label>
          <Input id="login-pin" value={pin} onChange={(e) => setPin(e.target.value)} type="password" autoComplete="current-password" required />
        </div>
        <Button variant="primary" disabled={submitting} type="submit">
          {submitting ? t('login.submitting') : t('login.submit')}
        </Button>
      </form>
      <p className="text-sm text-muted">
        {t('login.noAccount')} <Link to="/">{t('login.register')}</Link>
      </p>
    </Page>
  );
}
