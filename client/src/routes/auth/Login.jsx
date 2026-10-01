import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

function homeFor(role) {
  if (role === 'ADMIN') return '/admin';
  if (role === 'BOARDMAN') return '/boardman';
  return '/better';
}

export default function Login() {
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
      <div className="page">
        <h1>Enter your code</h1>
        <p className="muted">Open your authenticator app and enter the 6-digit code for StreetBoardman.</p>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={onSubmitCode}>
          <div className="field">
            <label htmlFor="mfa-code">Authentication code</label>
            <input
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
          <button className="btn btn-primary" disabled={submitting || code.length !== 6} type="submit">
            {submitting ? 'Verifying...' : 'Verify'}
          </button>
        </form>
        <p className="muted">
          <button type="button" className="btn btn-secondary" onClick={startOver}>
            Back to login
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Log In</h1>
      {error && <div className="error-banner">{error}</div>}
      <form onSubmit={onSubmitPin}>
        <div className="field">
          <label>Phone number</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" required />
        </div>
        <div className="field">
          <label>PIN / Password</label>
          <input value={pin} onChange={(e) => setPin(e.target.value)} type="password" required />
        </div>
        <button className="btn btn-primary" disabled={submitting} type="submit">
          {submitting ? 'Logging in...' : 'Log In'}
        </button>
      </form>
      <p className="muted">
        No account? <Link to="/">Register</Link>
      </p>
    </div>
  );
}
