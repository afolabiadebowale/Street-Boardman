import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';

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

  if (!competition) return <div className="page">Loading...</div>;

  const selectedOption = competition.betOptions.find((o) => o.id === selectedOptionId);
  const selectedOdds = competition.pool.options.find((o) => o.id === selectedOptionId);
  const estimatedPayout = selectedOdds?.payoutPer100 && stake
    ? ((Number(selectedOdds.payoutPer100) * Number(stake)) / 100).toFixed(2)
    : null;

  if (reviewing) {
    return (
      <>
        <TopBar title={competition.title} />
        <div className="page">
          <h2>Confirm your bet</h2>
          {error && <div className="error-banner">{error}</div>}
          <div className="card">
            <p className="ticket-row"><span>Competition</span><span>{competition.title}</span></p>
            <p className="ticket-row"><span>Your pick</span><span>{selectedOption?.label}</span></p>
            <p className="ticket-row"><span>Stake</span><span>₦{Number(stake).toLocaleString()}</span></p>
            {estimatedPayout && (
              <p className="ticket-row"><span>Estimated payout</span><span>₦{Number(estimatedPayout).toLocaleString()}</span></p>
            )}
          </div>
          <p className="muted">Estimate only — the final payout depends on the pool when betting closes.</p>
          <button className="btn btn-primary" type="button" onClick={onConfirm} disabled={submitting} style={{ marginTop: 16 }}>
            {submitting ? 'Placing bet...' : 'Confirm Bet'}
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => setReviewing(false)} disabled={submitting} style={{ marginTop: 8 }}>
            Edit
          </button>
        </div>
        <BottomNav role="BETTER" />
      </>
    );
  }

  return (
    <>
      <TopBar title={competition.title} />
      <div className="page">
        <p className="muted">{competition.category} · Betting closes {new Date(competition.bettingDeadline).toLocaleString()}</p>
        {competition.description && <p>{competition.description}</p>}
        {competition.boardman && (
          <p className="muted">
            Run by <Link to={`/better/boardmen/${competition.boardman.profileId}`}>{competition.boardman.name}</Link> · {competition.boardman.location}
            {competition.boardman.trustScore != null && <span className="trust-badge" style={{ marginLeft: 6 }}>Trust {competition.boardman.trustScore}</span>}
          </p>
        )}
        <p className="muted">Pool so far: ₦{Number(competition.pool.totalPool).toLocaleString()}</p>
        {competition.pool.notices.map((n) => (
          <div key={n.code} className="notice-banner">{n.message}</div>
        ))}

        <h2>Choose your bet</h2>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={onReview}>
          {competition.betOptions.map((opt) => {
            const odds = competition.pool.options.find((o) => o.id === opt.id);
            return (
              <label key={opt.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="option"
                  value={opt.id}
                  checked={selectedOptionId === opt.id}
                  onChange={() => setSelectedOptionId(opt.id)}
                />
                <span style={{ flex: 1 }}>{opt.label}</span>
                {odds?.payoutPer100 && <span className="muted">₦100 → ₦{odds.payoutPer100}</span>}
              </label>
            );
          })}

          <div className="field" style={{ marginTop: 16 }}>
            <label>Stake (₦)</label>
            <input
              type="number"
              min="100"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              placeholder="e.g. 5000"
              required
            />
          </div>

          <button className="btn btn-primary" type="submit" disabled={!selectedOptionId || !stake}>
            Review Bet
          </button>
        </form>
      </div>
      <BottomNav role="BETTER" />
    </>
  );
}
