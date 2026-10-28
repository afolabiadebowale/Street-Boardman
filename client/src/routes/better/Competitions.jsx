import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';

export default function Competitions() {
  const [competitions, setCompetitions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/competitions').then((d) => setCompetitions(d.competitions)).finally(() => setLoading(false));
  }, []);

  return (
    <>
      <TopBar title="Available Competitions" />
      <div className="page">
        {loading && <p className="muted">Loading...</p>}
        {!loading && competitions.length === 0 && <p className="muted">No open competitions right now. Check back soon.</p>}
        {competitions.map((c) => (
          <Link key={c.id} to={`/better/competitions/${c.id}`} className="card" style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}>
            <span className="badge badge-open">BETTING OPEN</span>
            <h2 style={{ marginTop: 8 }}>{c.title}</h2>
            <p className="muted">{c.category} · Closes {new Date(c.bettingDeadline).toLocaleString()}</p>
            <p className="muted">{c.betOptions.length} betting options · Pool ₦{Number(c.pool.totalPool).toLocaleString()}</p>
            {c.boardman && (
              <p className="muted">
                Run by {c.boardman.name}
                {c.boardman.trustScore != null && <span className="trust-badge" style={{ marginLeft: 6 }}>Trust {c.boardman.trustScore}</span>}
              </p>
            )}
            {c.pool.notices.map((n) => (
              <p key={n.code} className="muted" style={{ color: '#8a5b00' }}>{n.message}</p>
            ))}
          </Link>
        ))}
      </div>
      <BottomNav role="BETTER" />
    </>
  );
}
