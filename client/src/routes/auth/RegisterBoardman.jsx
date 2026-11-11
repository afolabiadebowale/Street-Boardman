import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Page } from '../../components/ui/page';

export default function RegisterBoardman() {
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
      <h1>Become a Boardman</h1>
      <p className="text-sm text-muted">
        New Boardman accounts start as PENDING_APPROVAL. An Admin reviews and approves you before you can run
        real competitions.
      </p>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {message && <div className="success-banner" role="status">{message}</div>}
      <form onSubmit={onSubmit}>
        <div className="mb-4">
          <Label htmlFor="reg-boardman-name">Full name</Label>
          <Input id="reg-boardman-name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required />
        </div>
        <div className="mb-4">
          <Label htmlFor="reg-boardman-phone">Phone number</Label>
          <Input id="reg-boardman-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" required />
        </div>
        <div className="mb-4">
          <Label htmlFor="reg-boardman-pin">Choose a PIN (4+ digits)</Label>
          <Input id="reg-boardman-pin" value={pin} onChange={(e) => setPin(e.target.value)} type="password" autoComplete="new-password" required />
        </div>
        <div className="mb-4">
          <Label htmlFor="reg-boardman-location">Location</Label>
          <Input
            id="reg-boardman-location"
            value={businessLocation}
            onChange={(e) => setBusinessLocation(e.target.value)}
            placeholder="e.g. Yaba, Lagos"
            required
          />
        </div>
        <Button variant="primary" disabled={submitting} type="submit">
          {submitting ? 'Submitting...' : 'Apply as Boardman'}
        </Button>
      </form>
      <p className="text-sm text-muted">
        Already registered? <Link to="/login">Log in</Link>
      </p>
    </Page>
  );
}
