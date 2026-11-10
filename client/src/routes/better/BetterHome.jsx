import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Page } from '../../components/ui/page';

export default function BetterHome() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState(null);
  const [competitions, setCompetitions] = useState([]);

  useEffect(() => {
    api.get('/wallet/me').then((d) => setWallet(d.wallet));
    api.get('/competitions').then((d) => setCompetitions(d.competitions.slice(0, 3)));
  }, []);

  return (
    <>
      <TopBar title="StreetBoardman" />
      <Page>
        <h1>Welcome, {user?.fullName}</h1>

        <Card>
          <p className="text-sm text-muted">Wallet balance</p>
          <h2>₦{wallet ? Number(wallet.balance).toLocaleString() : '...'}</h2>
          <Button asChild variant="primary" className="mt-2">
            <Link to="/better/deposit">Deposit</Link>
          </Button>
        </Card>

        <h2>Open competitions</h2>
        {competitions.length === 0 && <p className="text-sm text-muted">No competitions open right now.</p>}
        {competitions.map((c) => (
          <Card key={c.id} asChild className="text-inherit no-underline">
            <Link to={`/better/competitions/${c.id}`}>
              <strong>{c.title}</strong>
              <p className="text-sm text-muted">{c.category} · Betting closes {new Date(c.bettingDeadline).toLocaleString()}</p>
            </Link>
          </Card>
        ))}
        <Button asChild variant="secondary">
          <Link to="/better/competitions">See all competitions</Link>
        </Button>
      </Page>
      <BottomNav role="BETTER" />
    </>
  );
}
