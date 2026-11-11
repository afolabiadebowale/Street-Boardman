import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Page } from '../../components/ui/page';

export default function RegisterBetter() {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { refresh } = useAuth();
  const navigate = useNavigate();

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post('/auth/register/better', { fullName, phone, pin });
      await refresh();
      navigate('/better');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Page>
      <h1>Register as a Better</h1>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <form onSubmit={onSubmit}>
        <div className="mb-4">
          <Label htmlFor="reg-better-name">Full name</Label>
          <Input id="reg-better-name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required />
        </div>
        <div className="mb-4">
          <Label htmlFor="reg-better-phone">Phone number</Label>
          <Input id="reg-better-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" required />
        </div>
        <div className="mb-4">
          <Label htmlFor="reg-better-pin">Choose a PIN (4+ digits)</Label>
          <Input id="reg-better-pin" value={pin} onChange={(e) => setPin(e.target.value)} type="password" autoComplete="new-password" required />
        </div>
        <Button variant="primary" disabled={submitting} type="submit">
          {submitting ? 'Creating account...' : 'Register'}
        </Button>
      </form>
      <p className="text-sm text-muted">
        Already registered? <Link to="/login">Log in</Link>
      </p>
    </Page>
  );
}
