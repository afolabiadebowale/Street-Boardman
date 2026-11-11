import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Page } from '../../components/ui/page';

export default function Disputes() {
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
      <TopBar title="Disputes" />
      <Page>
        {error && <div className="error-banner" role="alert">{error}</div>}
        {disputes.length === 0 && <p className="text-sm text-muted">No disputes.</p>}
        {disputes.map((d) => (
          <Card key={d.id} data-testid="dispute-card">
            <div className="flex justify-between">
              <strong>{d.competition.title}</strong>
              <Badge variant={d.status === 'OPEN' ? 'disputed' : 'closed'}>{d.status}</Badge>
            </div>
            <p className="text-sm text-muted">Raised by {d.raisedByUser.fullName} ({d.raisedByUser.phone})</p>
            <p>{d.reason}</p>
            {(d.status === 'OPEN' || d.status === 'UNDER_REVIEW') && (
              <div className="mt-2 flex gap-2">
                <Button variant="primary" className="mb-0 flex-1" onClick={() => resolve(d.id, 'CONFIRM')}>
                  Confirm Result & Pay Out
                </Button>
                <Button variant="destructive" className="mb-0 flex-1" onClick={() => resolve(d.id, 'CANCEL')}>
                  Cancel & Refund
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
