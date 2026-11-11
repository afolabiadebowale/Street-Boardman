import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Page } from '../../components/ui/page';

export default function ActiveCompetitions() {
  const { t } = useTranslation('boardman');
  const [competitions, setCompetitions] = useState([]);

  useEffect(() => {
    api.get('/competitions/mine/list').then((d) => setCompetitions(d.competitions));
  }, []);

  return (
    <>
      <TopBar title={t('active.title')} />
      <Page>
        {competitions.length === 0 && <p className="text-sm text-muted">{t('active.none')}</p>}
        {competitions.map((c) => (
          <Card key={c.id} asChild className="text-inherit no-underline">
            <Link to={`/boardman/competitions/${c.id}`}>
              <div className="flex justify-between">
                <strong>{c.title}</strong>
                <Badge variant="open">{c.status.replace('_', ' ')}</Badge>
              </div>
              <p className="text-sm text-muted">{t('active.closes', { category: c.category, date: new Date(c.bettingDeadline).toLocaleString() })}</p>
            </Link>
          </Card>
        ))}
      </Page>
      <BottomNav role="BOARDMAN" />
    </>
  );
}
