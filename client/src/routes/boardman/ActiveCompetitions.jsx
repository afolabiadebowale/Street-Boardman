import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';

export default function ActiveCompetitions() {
  const [competitions, setCompetitions] = useState([]);

  useEffect(() => {
    api.get('/competitions/mine/list').then((d) => setCompetitions(d.competitions));
  }, []);

  return (
    <>
      <TopBar title="My Competitions" />
      <div className="px-4 pb-24 pt-4">
        {competitions.length === 0 && <p className="text-sm text-muted">You haven't created any competitions yet.</p>}
        {competitions.map((c) => (
          <Card key={c.id} asChild className="text-inherit no-underline">
            <Link to={`/boardman/competitions/${c.id}`}>
              <div className="flex justify-between">
                <strong>{c.title}</strong>
                <Badge variant="open">{c.status.replace('_', ' ')}</Badge>
              </div>
              <p className="text-sm text-muted">{c.category} · Closes {new Date(c.bettingDeadline).toLocaleString()}</p>
            </Link>
          </Card>
        ))}
      </div>
      <BottomNav role="BOARDMAN" />
    </>
  );
}
