import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';

export default function CompetitionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [competition, setCompetition] = useState(null);
  const [selectedOptionId, setSelectedOptionId] = useState(null);
  const [stake, setStake] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // FEAT-037: the form never submits straight to the API. Reviewing shows a
  // confirmation summary; only confirming it places the bet, so a misclick
  // on the stake field or the wrong radio can't cost a Better money.
  const [reviewing, setReviewing] = useState(false);

  const load = () => api.get(`/competitions/${id}`).then((d) => setCompetition(d.competition));

  useEffect(() => { load(); }, [id]);

  const onReview = (e) => {
    e.preventDefault();
    setReviewing(true);
  };

  const onConfirm = async () => {
    setError('');
    setSubmitting(true);
    try {
      const { bet } = await api.post('/bets', { betOptionId: selectedOptionId, stake: Number(stake) });
      navigate(`/better/my-bets/${bet.betCode}`);
    } catch (err) {
      setError(err.message);
      setReviewing(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (!competition) return <div className="px-4 pb-24 pt-4">Loading...</div>;

  const selectedOption = competition.betOptions.find((o) => o.id === selectedOptionId);
  const selectedOdds = competition.pool.options.find((o) => o.id === selectedOptionId);
  const estimatedPayout = selectedOdds?.payoutPer100 && stake
    ? ((Number(selectedOdds.payoutPer100) * Number(stake)) / 100).toFixed(2)
    : null;

  if (reviewing) {
    return (
      <>
        <TopBar title={competition.title} />
        <div className="px-4 pb-24 pt-4">
          <h2>Confirm your bet</h2>
          {error && <div className="error-banner">{error}</div>}
          <Card>
            <p className="mb-1.5 flex justify-between text-[15px]"><span>Competition</span><span>{competition.title}</span></p>
            <p className="mb-1.5 flex justify-between text-[15px]"><span>Your pick</span><span>{selectedOption?.label}</span></p>
            <p className="mb-1.5 flex justify-between text-[15px]"><span>Stake</span><span>₦{Number(stake).toLocaleString()}</span></p>
            {estimatedPayout && (
              <p className="mb-1.5 flex justify-between text-[15px]"><span>Estimated payout</span><span>₦{Number(estimatedPayout).toLocaleString()}</span></p>
            )}
          </Card>
          <p className="text-sm text-muted">Estimate only — the final payout depends on the pool when betting closes.</p>
          <Button variant="primary" type="button" onClick={onConfirm} disabled={submitting} className="mt-4">
            {submitting ? 'Placing bet...' : 'Confirm Bet'}
          </Button>
          <Button variant="secondary" type="button" onClick={() => setReviewing(false)} disabled={submitting} className="mt-2">
            Edit
          </Button>
        </div>
        <BottomNav role="BETTER" />
      </>
    );
  }

  return (
    <>
      <TopBar title={competition.title} />
      <div className="px-4 pb-24 pt-4">
        <p className="text-sm text-muted">{competition.category} · Betting closes {new Date(competition.bettingDeadline).toLocaleString()}</p>
        {competition.description && <p>{competition.description}</p>}
        {competition.boardman && (
          <p className="text-sm text-muted">
            Run by <Link to={`/better/boardmen/${competition.boardman.profileId}`}>{competition.boardman.name}</Link> · {competition.boardman.location}
            {competition.boardman.trustScore != null && <Badge variant="trust" className="ml-1.5">Trust {competition.boardman.trustScore}</Badge>}
          </p>
        )}
        <p className="text-sm text-muted">Pool so far: ₦{Number(competition.pool.totalPool).toLocaleString()}</p>
        {competition.pool.notices.map((n) => (
          <div key={n.code} className="mb-4 rounded-[10px] bg-[#fff4e0] p-3 text-sm text-[#8a5b00]">{n.message}</div>
        ))}

        <h2>Choose your bet</h2>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={onReview}>
          {competition.betOptions.map((opt) => {
            const odds = competition.pool.options.find((o) => o.id === opt.id);
            return (
              <Card key={opt.id} asChild className="flex cursor-pointer items-center gap-3">
                <label>
                  <input
                    type="radio"
                    name="option"
                    value={opt.id}
                    checked={selectedOptionId === opt.id}
                    onChange={() => setSelectedOptionId(opt.id)}
                  />
                  <span className="flex-1">{opt.label}</span>
                  {odds?.payoutPer100 && <span className="text-sm text-muted">₦100 → ₦{odds.payoutPer100}</span>}
                </label>
              </Card>
            );
          })}

          <div className="mb-4 mt-4">
            <Label>Stake (₦)</Label>
            <Input
              type="number"
              min="100"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              placeholder="e.g. 5000"
              required
            />
          </div>

          <Button variant="primary" type="submit" disabled={!selectedOptionId || !stake}>
            Review Bet
          </Button>
        </form>
      </div>
      <BottomNav role="BETTER" />
    </>
  );
}
