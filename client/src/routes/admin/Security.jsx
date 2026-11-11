import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Page } from '../../components/ui/page';

function CodeInput({ value, onChange, id }) {
  return (
    <Input
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="\d{6}"
      maxLength={6}
      required
    />
  );
}

// Staff passwords must be 12+ characters (TASK-036). Changing it signs out
// every other device; this one gets fresh cookies and stays signed in.
function ChangePassword({ required, onChanged }) {
  const { t } = useTranslation('admin');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirm) {
      setError(t('security.passwordMismatch'));
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
      await onChanged();
    } catch (err) {
      setError(err.message);
      setCurrentPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card asChild>
      <form onSubmit={submit}>
        <p className="text-sm text-muted">{t('security.passwordLabel')}</p>
        {required && <p><strong>{t('security.passwordTooShort')}</strong></p>}
        {error && <div className="error-banner" role="alert">{error}</div>}
        <div className="mb-4">
          <Label htmlFor="current-password">{t('security.currentPasswordLabel')}</Label>
          <Input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
        </div>
        <div className="mb-4">
          <Label htmlFor="new-password">{t('security.newPasswordLabel')}</Label>
          <Input id="new-password" type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
        </div>
        <div className="mb-4">
          <Label htmlFor="confirm-password">{t('security.confirmPasswordLabel')}</Label>
          <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
        <p className="text-sm text-muted">{t('security.signOutWarning')}</p>
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? t('security.saving') : t('security.changePassword')}
        </Button>
      </form>
    </Card>
  );
}

// Staff MFA enrollment (TASK-031). Setup only turns MFA on after a real
// code from the authenticator app proves the key was actually saved —
// the server enforces that too, this just walks the admin through it.
export default function Security() {
  const { t } = useTranslation('admin');
  const { user, refresh } = useAuth();
  const gate = user?.staffSecurity;
  const gated = gate && gate.enforced && (gate.mfaRequired || gate.passwordChangeRequired);
  const [setup, setSetup] = useState(null); // { secret, otpauthUrl, qrDataUrl }
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const startSetup = () =>
    run(async () => {
      const { secret, otpauthUrl } = await api.post('/auth/mfa/setup');
      // Only this page needs a QR encoder, so it isn't in the main bundle.
      const QRCode = await import('qrcode');
      const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 });
      setSetup({ secret, otpauthUrl, qrDataUrl });
      setCode('');
    });

  const confirmSetup = (e) => {
    e.preventDefault();
    run(async () => {
      await api.post('/auth/mfa/setup/confirm', { code });
      setSetup(null);
      setCode('');
      await refresh();
      setNotice(t('security.mfaEnabledNotice'));
    });
  };

  const disable = (e) => {
    e.preventDefault();
    run(async () => {
      await api.post('/auth/mfa/disable', { code });
      setCode('');
      await refresh();
      setNotice(t('security.mfaDisabledNotice'));
    });
  };

  return (
    <>
      <TopBar title={t('security.title')} />
      <Page>
        {gated && (
          <div className="error-banner" role="alert">
            {t('security.lockedPrefix')}
            {[gate.mfaRequired && t('security.mfaAction'), gate.passwordChangeRequired && t('security.passwordAction')]
              .filter(Boolean)
              .join(' and ')}
            .
          </div>
        )}
        {error && <div className="error-banner" role="alert">{error}</div>}
        {notice && <div className="success-banner" role="status">{notice}</div>}

        <Card>
          <p className="text-sm text-muted">{t('security.twoFactor')}</p>
          <p className="text-[18px] font-bold">{user?.mfaEnabled ? t('security.on') : t('security.off')}</p>
          {!user?.mfaEnabled && (
            <p className="text-sm text-muted">
              {t('security.mfaDescription')}
            </p>
          )}
        </Card>

        {!user?.mfaEnabled && !setup && (
          <Button type="button" variant="primary" onClick={startSetup} disabled={busy}>
            {busy ? t('security.preparing') : t('security.setupButton')}
          </Button>
        )}

        {setup && (
          <Card>
            <p>
              <strong>1.</strong> {t('security.scanStep')}
            </p>
            <img src={setup.qrDataUrl} alt={t('security.qrAlt')} width={220} height={220} />
            <p className="text-sm text-muted">
              {t('security.cantScan')}<a href={setup.otpauthUrl}>{t('security.openInApp')}</a>{t('security.orEnterKey')}
            </p>
            <p><code className="break-all">{setup.secret}</code></p>
            <form onSubmit={confirmSetup}>
              <div className="mb-4">
                <Label htmlFor="mfa-setup-code"><strong>2.</strong> {t('security.enterCodeLabel')}</Label>
                <CodeInput id="mfa-setup-code" value={code} onChange={setCode} />
              </div>
              <Button variant="primary" type="submit" disabled={busy || code.length !== 6}>
                {busy ? t('security.checking') : t('security.turnOn')}
              </Button>
            </form>
          </Card>
        )}

        {user?.mfaEnabled && (
          <Card asChild>
            <form onSubmit={disable}>
              <p className="text-sm text-muted">{t('security.disableHint')}</p>
              <div className="mb-4">
                <Label htmlFor="mfa-disable-code">{t('security.authCodeLabel')}</Label>
                <CodeInput id="mfa-disable-code" value={code} onChange={setCode} />
              </div>
              <Button variant="destructive" type="submit" disabled={busy || code.length !== 6}>
                {t('security.turnOff')}
              </Button>
            </form>
          </Card>
        )}

        <ChangePassword
          required={Boolean(gate?.passwordChangeRequired)}
          onChanged={async () => {
            await refresh();
            setNotice(t('security.passwordChangedNotice'));
          }}
        />
      </Page>
      <BottomNav role="ADMIN" />
    </>
  );
}
