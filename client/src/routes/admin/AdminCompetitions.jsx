import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Page } from '../../components/ui/page';

export default function AdminCompetitions() {
  const { t } = useTranslation('admin');
  const [competitions, setCompetitions] = useState([]);

  useEffect(() => {
    api.get('/admin/competitions').then((d) => setCompetitions(d.competitions));
  }, []);

  return (
    <>
      <TopBar title={t('competitions.title')} />
      <Page>
        {competitions.map((c) => (
          <Card key={c.id}>
            <div className="flex justify-between">
              <strong>{c.title}</strong>
              <Badge variant="open">{c.status.replace('_', ' ')}</Badge>
            </div>
            <p className="text-sm text-muted">{t('competitions.boardman', { name: c.boardmanProfile.user.fullName, phone: c.boardmanProfile.user.phone })}</p>
            <p className="text-sm text-muted">{t('competitions.closes', { category: c.category, date: new Date(c.bettingDeadline).toLocaleString() })}</p>
          </Card>
        ))}
      </Page>
      <BottomNav role="ADMIN" />
    </>
  );
}
