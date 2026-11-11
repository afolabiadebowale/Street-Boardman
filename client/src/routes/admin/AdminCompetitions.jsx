import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Page } from '../../components/ui/page';

export default function AdminCompetitions() {
  const [competitions, setCompetitions] = useState([]);

  useEffect(() => {
    api.get('/admin/competitions').then((d) => setCompetitions(d.competitions));
  }, []);

  return (
    <>
      <TopBar title="All Competitions" />
      <Page>
        {competitions.map((c) => (
          <Card key={c.id}>
            <div className="flex justify-between">
              <strong>{c.title}</strong>
              <Badge variant="open">{c.status.replace('_', ' ')}</Badge>
            </div>
            <p className="text-sm text-muted">Boardman: {c.boardmanProfile.user.fullName} ({c.boardmanProfile.user.phone})</p>
            <p className="text-sm text-muted">{c.category} · Closes {new Date(c.bettingDeadline).toLocaleString()}</p>
          </Card>
        ))}
      </Page>
      <BottomNav role="ADMIN" />
    </>
  );
}
