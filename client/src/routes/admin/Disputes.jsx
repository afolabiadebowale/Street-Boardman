import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Page } from '../../components/ui/page';

export default function Disputes() {
  const { t } = useTranslation('admin');
  const [disputes, setDisputes] = useState([]);
  const [error, setError] = useState('');

  const load = () => api.get('/admin/disputes').then((d) => setDisputes(d.disputes));
  useEffect(() => { load(); }, []);

  const resolve = async (id, action) => {
    setError('');
    try {
      await api.patch(`/admin/disputes/${id}/resolve`, { action });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <TopBar title={t('disputes.title')} />
      <Page>
        {error && <div className="error-banner" role="alert">{error}</div>}
        {disputes.length === 0 && <p className="text-sm text-muted">{t('disputes.none')}</p>}
        {disputes.map((d) => (
          <Card key={d.id} data-testid="dispute-card">
            <div className="flex justify-between">
              <strong>{d.competition.title}</strong>
              <Badge variant={d.status === 'OPEN' ? 'disputed' : 'closed'}>{d.status}</Badge>
            </div>
            <p className="text-sm text-muted">{t('disputes.raisedBy', { name: d.raisedByUser.fullName, phone: d.raisedByUser.phone })}</p>
            <p>{d.reason}</p>
            {(d.status === 'OPEN' || d.status === 'UNDER_REVIEW') && (
              <div className="mt-2 flex gap-2">
                <Button variant="primary" className="mb-0 flex-1" onClick={() => resolve(d.id, 'CONFIRM')}>
                  {t('disputes.confirmPayout')}
                </Button>
                <Button variant="destructive" className="mb-0 flex-1" onClick={() => resolve(d.id, 'CANCEL')}>
                  {t('disputes.cancelRefund')}
                </Button>
              </div>
            )}
          </Card>
        ))}
      </Page>
      <BottomNav role="ADMIN" />
    </>
  );
}
