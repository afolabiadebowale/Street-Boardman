import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Card } from '../../components/ui/card';
import { Page } from '../../components/ui/page';

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    api.get('/admin/audit-logs').then((d) => setLogs(d.logs));
  }, []);

  return (
    <>
      <TopBar title="Audit Logs" />
      <Page>
        {logs.map((log) => (
          <Card key={log.id}>
            <strong>{log.action}</strong>
            <p className="text-sm text-muted">{log.entityType} · {log.entityId}</p>
            <p className="text-sm text-muted">{new Date(log.createdAt).toLocaleString()}</p>
          </Card>
        ))}
      </Page>
      <BottomNav role="ADMIN" />
    </>
  );
}
