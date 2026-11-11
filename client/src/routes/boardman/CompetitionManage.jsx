import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input, Textarea } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';
import { Page } from '../../components/ui/page';

export default function CompetitionManage() {
  const { id } = useParams();
  const [competition, setCompetition] = useState(null);
  const [bets, setBets] = useState([]);
  const [winningOptionId, setWinningOptionId] = useState('');
  const [finalScore, setFinalScore] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    api.get(`/competitions/${id}`).then((d) => setCompetition(d.competition));
    api.get(`/competitions/${id}/bets`).then((d) => setBets(d.bets)).catch(() => {});
  };

  useEffect(() => { load(); }, [id]);

  const totalStaked = bets.reduce((sum, b) => sum + Number(b.stake), 0);

  const onCloseBetting = async () => {
    setError('');
    try {
      await api.patch(`/competitions/${id}/close-betting`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const onSubmitResult = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post(`/competitions/${id}/result`, { winningOptionId, finalScore, notes });
      setMessage('Result submitted. It will be confirmed automatically if nobody disputes it within the confirmation window.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!competition) return <Page role="status">Loading...</Page>;

  return (
    <>
      <TopBar title={competition.title} />
      <Page>
        <Badge variant="open">{competition.status.replace('_', ' ')}</Badge>
        <p className="mt-2 text-sm text-muted">
          Betting deadline: {new Date(competition.bettingDeadline).toLocaleString()}
        </p>

        {error && <div className="error-banner" role="alert">{error}</div>}
        {message && <div className="success-banner" role="status">{message}</div>}

        <Card>
          <p className="text-sm text-muted">Total staked so far</p>
          <p className="text-[18px] font-bold">₦{totalStaked.toLocaleString()}</p>
          <p className="text-sm text-muted">{bets.length} bet(s) received</p>
        </Card>

        {competition.status === 'BETTING_OPEN' && (
          <Button variant="destructive" onClick={onCloseBetting}>Close Betting</Button>
        )}

        {competition.status === 'BETTING_CLOSED' && (
          <>
            <h2>Submit Result</h2>
            <form onSubmit={onSubmitResult}>
              {competition.betOptions.map((opt) => (
                <Card key={opt.id} asChild className="flex items-center gap-3">
                  <label>
                    <input
                      type="radio"
                      name="winner"
                      value={opt.id}
                      checked={winningOptionId === opt.id}
                      onChange={() => setWinningOptionId(opt.id)}
                    />
                    <span>{opt.label}</span>
                  </label>
                </Card>
              ))}
              <div className="mb-4">
                <Label htmlFor="final-score">Final score (optional)</Label>
                <Input id="final-score" value={finalScore} onChange={(e) => setFinalScore(e.target.value)} placeholder="e.g. 2-1" />
              </div>
              <div className="mb-4">
                <Label htmlFor="result-notes">Notes (optional)</Label>
                <Textarea id="result-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
              </div>
              <Button variant="primary" type="submit" disabled={!winningOptionId || submitting}>
                {submitting ? 'Submitting...' : 'Submit Result'}
              </Button>
            </form>
          </>
        )}

        {['PENDING_CONFIRMATION', 'DISPUTED', 'RESULT_CONFIRMED', 'PAYOUT_PROCESSING', 'COMPLETED'].includes(competition.status) && (
          <Card>
            <p className="text-sm text-muted">Result status</p>
            <strong>{competition.result?.status}</strong>
            {competition.status === 'DISPUTED' && (
              <p className="mt-2">
                This result is disputed. Only the Platform Admin can resolve it now — you cannot confirm your own
                disputed result.
              </p>
            )}
          </Card>
        )}

        <h2 className="mt-6">Bets received</h2>
        {bets.length === 0 && <p className="text-sm text-muted">No bets yet.</p>}
        {bets.slice(0, 20).map((bet) => (
          <Card key={bet.id}>
            <div className="flex justify-between">
              <span>{bet.better.fullName}</span>
              <strong>₦{Number(bet.stake).toLocaleString()}</strong>
            </div>
            <p className="text-sm text-muted">{bet.betOption.label} · {bet.betCode}</p>
          </Card>
        ))}
      </Page>
      <BottomNav role="BOARDMAN" />
    </>
  );
}
