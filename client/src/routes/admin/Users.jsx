import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Page } from '../../components/ui/page';

export default function Users() {
  const { t } = useTranslation('admin');
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');

  const load = () => api.get('/admin/users').then((d) => setUsers(d.users));
  useEffect(() => { load(); }, []);

  const act = async (id, action) => {
    setError('');
    try {
      await api.patch(`/admin/users/${id}/${action}`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <TopBar title={t('users.title')} />
      <Page>
        {error && <div className="error-banner" role="alert">{error}</div>}
        {users.map((u) => (
          <Card key={u.id}>
            <div className="flex justify-between">
              <strong>{u.fullName}</strong>
              <Badge variant={u.status === 'ACTIVE' ? 'open' : 'disputed'}>{u.status}</Badge>
            </div>
            <p className="text-sm text-muted">{u.phone} · {u.role}</p>
            {u.role !== 'ADMIN' && (
              u.status === 'ACTIVE' ? (
                <Button variant="destructive" className="mt-2" onClick={() => act(u.id, 'suspend')}>{t('users.suspend')}</Button>
              ) : (
                <Button variant="primary" className="mt-2" onClick={() => act(u.id, 'reactivate')}>{t('users.reactivate')}</Button>
              )
            )}
          </Card>
        ))}
      </Page>
      <BottomNav role="ADMIN" />
    </>
  );
}
