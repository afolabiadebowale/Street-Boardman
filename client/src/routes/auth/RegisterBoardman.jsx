import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

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
    <div className="px-4 pb-24 pt-4">
      <h1>Become a Boardman</h1>
      <p className="text-sm text-muted">
        New Boardman accounts start as PENDING_APPROVAL. An Admin reviews and approves you before you can run
        real competitions.
      </p>
      {error && <div className="error-banner">{error}</div>}
      {message && <div className="success-banner">{message}</div>}
      <form onSubmit={onSubmit}>
        <div className="mb-4">
          <Label>Full name</Label>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>
        <div className="mb-4">
          <Label>Phone number</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" required />
        </div>
        <div className="mb-4">
          <Label>Choose a PIN (4+ digits)</Label>
          <Input value={pin} onChange={(e) => setPin(e.target.value)} type="password" required />
        </div>
        <div className="mb-4">
          <Label>Location</Label>
          <Input
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
    </div>
  );
}
