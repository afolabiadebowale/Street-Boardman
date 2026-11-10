import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';

// Matches browseCompetitionsQuery's category enum (server/validators/schemas.js).
const CATEGORIES = [
  { value: '', label: 'All categories' },
  { value: 'FOOTBALL', label: 'Football' },
  { value: 'SNOOKER', label: 'Snooker' },
  { value: 'FIGHT', label: 'Fight' },
  { value: 'TABLE_GAME', label: 'Table game' },
  { value: 'OTHER', label: 'Other' },
];

export default function Competitions() {
  const [competitions, setCompetitions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  // The server already supported search/category/location filtering
  // (FEAT-043) — this just wires it up. Debounced so free typing in the
  // search/location fields doesn't fire a request per keystroke; the first
  // load (mount) skips the debounce so the page doesn't sit idle for 300ms.
  const isFirstRun = useRef(true);

  useEffect(() => {
    const delay = isFirstRun.current ? 0 : 300;
    isFirstRun.current = false;
    const handle = setTimeout(() => {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (category) params.set('category', category);
      if (location.trim()) params.set('location', location.trim());
      const query = params.toString();
      setLoading(true);
      api.get(`/competitions${query ? `?${query}` : ''}`)
        .then((d) => setCompetitions(d.competitions))
        .finally(() => setLoading(false));
    }, delay);
    return () => clearTimeout(handle);
  }, [q, category, location]);

  const hasFilters = q.trim() || category || location.trim();

  return (
    <>
      <TopBar title="Available Competitions" />
      <div className="page">
        <div className="field">
          <label htmlFor="competition-search">Search</label>
          <input
            id="competition-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Team, player, or title"
          />
        </div>
        <div className="field">
          <label htmlFor="competition-category">Category</label>
          <select id="competition-category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="competition-location">Location</label>
          <input
            id="competition-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Lagos"
          />
        </div>

        {loading && <p className="muted">Loading...</p>}
        {!loading && competitions.length === 0 && (
          <p className="muted">
            {hasFilters ? 'No open competitions match your filters.' : 'No open competitions right now. Check back soon.'}
          </p>
        )}
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
