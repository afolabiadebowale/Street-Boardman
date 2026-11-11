import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Page } from '../../components/ui/page';

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [boardmanRate, setBoardmanRate] = useState('');
  const [platformRate, setPlatformRate] = useState('');
  const [windowHours, setWindowHours] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/admin/settings').then((d) => {
      setSettings(d.settings);
      setBoardmanRate(String(d.settings.boardmanCommissionRate * 100));
      setPlatformRate(String(d.settings.platformCommissionRate * 100));
      setWindowHours(String(d.settings.resultConfirmationWindowHours));
    });
  }, []);

  const onSave = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api.patch('/admin/settings', {
        boardmanCommissionRate: Number(boardmanRate) / 100,
        platformCommissionRate: Number(platformRate) / 100,
        resultConfirmationWindowHours: Number(windowHours),
      });
      setMessage('Settings updated. This only affects competitions created from now on.');
    } catch (err) {
      setError(err.message);
    }
  };

  if (!settings) return <Page role="status">Loading...</Page>;

  return (
    <>
      <TopBar title="System Settings" />
      <Page>
        <p className="text-sm text-muted">
          These are platform-wide defaults. Changing them never rewrites commissions already calculated on
          past or in-flight competitions — each competition locks in the rates that were active when it was created.
        </p>
        {error && <div className="error-banner" role="alert">{error}</div>}
        {message && <div className="success-banner" role="status">{message}</div>}
        <form onSubmit={onSave}>
          <div className="mb-4">
            <Label htmlFor="boardman-rate">Default Boardman commission (%)</Label>
            <Input id="boardman-rate" type="number" step="0.1" value={boardmanRate} onChange={(e) => setBoardmanRate(e.target.value)} />
          </div>
          <div className="mb-4">
            <Label htmlFor="platform-rate">Platform commission (%)</Label>
            <Input id="platform-rate" type="number" step="0.1" value={platformRate} onChange={(e) => setPlatformRate(e.target.value)} />
          </div>
          <div className="mb-4">
            <Label htmlFor="confirmation-window">Result confirmation window (hours)</Label>
            <Input id="confirmation-window" type="number" step="0.5" value={windowHours} onChange={(e) => setWindowHours(e.target.value)} />
          </div>
          <Button variant="primary" type="submit">Save Settings</Button>
        </form>
      </Page>
      <BottomNav role="ADMIN" />
    </>
  );
}
