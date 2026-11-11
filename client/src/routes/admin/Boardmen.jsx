import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Page } from '../../components/ui/page';

export default function Boardmen() {
  const [boardmen, setBoardmen] = useState([]);
  const [error, setError] = useState('');

  const load = () => api.get('/admin/boardmen').then((d) => setBoardmen(d.boardmen));
  useEffect(() => { load(); }, []);

  const act = async (id, action) => {
    setError('');
    try {
      await api.patch(`/admin/boardmen/${id}/${action}`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <TopBar title="Boardmen" />
      <Page>
        {error && <div className="error-banner" role="alert">{error}</div>}
        {boardmen.map((b) => (
          <Card key={b.id}>
            <div className="flex justify-between">
              <strong>{b.user.fullName}</strong>
              <Badge variant={b.approvalStatus === 'APPROVED' ? 'open' : 'pending'}>
                {b.approvalStatus}
              </Badge>
            </div>
            <p className="text-sm text-muted">{b.user.phone} · {b.businessLocation}</p>
            {b.approvalStatus === 'PENDING_APPROVAL' && (
              <div className="mt-2 flex gap-2">
                <Button variant="primary" className="mb-0 flex-1" onClick={() => act(b.id, 'approve')}>Approve</Button>
                <Button variant="destructive" className="mb-0 flex-1" onClick={() => act(b.id, 'reject')}>Reject</Button>
              </div>
            )}
            {b.approvalStatus === 'APPROVED' && (
              <Button variant="destructive" className="mt-2" onClick={() => act(b.id, 'suspend')}>Suspend</Button>
            )}
          </Card>
        ))}
      </Page>
      <BottomNav role="ADMIN" />
    </>
  );
}
