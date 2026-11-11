import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
  { value: '', labelKey: 'competitions.categories.all' },
  { value: 'FOOTBALL', labelKey: 'competitions.categories.football' },
  { value: 'SNOOKER', labelKey: 'competitions.categories.snooker' },
  { value: 'FIGHT', labelKey: 'competitions.categories.fight' },
  { value: 'TABLE_GAME', labelKey: 'competitions.categories.tableGame' },
  { value: 'OTHER', labelKey: 'competitions.categories.other' },
];

export default function Competitions() {
  const { t } = useTranslation('better');
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
      <TopBar title={t('competitions.title')} />
      <Page>
        <div className="mb-4">
          <Label htmlFor="competition-search">{t('competitions.searchLabel')}</Label>
          <Input
            id="competition-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('competitions.searchPlaceholder')}
          />
        </div>
        <div className="mb-4">
          <Label htmlFor="competition-category">{t('competitions.categoryLabel')}</Label>
          <Select id="competition-category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{t(c.labelKey)}</option>
            ))}
          </Select>
        </div>
        <div className="mb-4">
          <Label htmlFor="competition-location">{t('competitions.locationLabel')}</Label>
          <Input
            id="competition-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={t('competitions.locationPlaceholder')}
          />
        </div>

        {loading && <p role="status" className="text-sm text-muted">{t('common:loading')}</p>}
        {!loading && competitions.length === 0 && (
          <p className="text-sm text-muted">
            {hasFilters ? t('competitions.noneFiltered') : t('competitions.noneOpen')}
          </p>
        )}
        {competitions.map((c) => (
          <Card key={c.id} asChild className="text-inherit no-underline">
            <Link to={`/better/competitions/${c.id}`}>
              <Badge variant="open">{t('competitions.bettingOpen')}</Badge>
              <h2 className="mt-2">{c.title}</h2>
              <p className="text-sm text-muted">{t('competitions.closes', { category: c.category, date: new Date(c.bettingDeadline).toLocaleString() })}</p>
              <p className="text-sm text-muted">{t('competitions.poolInfo', { count: c.betOptions.length, pool: Number(c.pool.totalPool).toLocaleString() })}</p>
              {c.boardman && (
                <p className="text-sm text-muted">
                  {t('competitions.runBy', { name: c.boardman.name })}
                  {c.boardman.trustScore != null && <Badge variant="trust" className="ml-1.5">{t('competitions.trust', { score: c.boardman.trustScore })}</Badge>}
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
