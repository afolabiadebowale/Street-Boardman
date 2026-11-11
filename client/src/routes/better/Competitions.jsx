import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Card } from '../../components/ui/card';
import { Input, Select } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';
import { Page } from '../../components/ui/page';

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
      <Page>
        <div className="mb-4">
          <Label htmlFor="competition-search">Search</Label>
          <Input
            id="competition-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Team, player, or title"
          />
        </div>
        <div className="mb-4">
          <Label htmlFor="competition-category">Category</Label>
          <Select id="competition-category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </Select>
        </div>
        <div className="mb-4">
          <Label htmlFor="competition-location">Location</Label>
          <Input
            id="competition-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Lagos"
          />
        </div>

        {loading && <p role="status" className="text-sm text-muted">Loading...</p>}
        {!loading && competitions.length === 0 && (
          <p className="text-sm text-muted">
            {hasFilters ? 'No open competitions match your filters.' : 'No open competitions right now. Check back soon.'}
          </p>
        )}
        {competitions.map((c) => (
          <Card key={c.id} asChild className="text-inherit no-underline">
            <Link to={`/better/competitions/${c.id}`}>
              <Badge variant="open">BETTING OPEN</Badge>
              <h2 className="mt-2">{c.title}</h2>
              <p className="text-sm text-muted">{c.category} · Closes {new Date(c.bettingDeadline).toLocaleString()}</p>
              <p className="text-sm text-muted">{c.betOptions.length} betting options · Pool ₦{Number(c.pool.totalPool).toLocaleString()}</p>
              {c.boardman && (
                <p className="text-sm text-muted">
                  Run by {c.boardman.name}
                  {c.boardman.trustScore != null && <Badge variant="trust" className="ml-1.5">Trust {c.boardman.trustScore}</Badge>}
                </p>
              )}
              {c.pool.notices.map((n) => (
                <p key={n.code} className="text-sm text-[#8a5b00]">{n.message}</p>
              ))}
            </Link>
          </Card>
        ))}
      </Page>
      <BottomNav role="BETTER" />
    </>
  );
}
