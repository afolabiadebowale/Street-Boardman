import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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

  const load = () => api.get(`/competitions/${id}`).then((d) => setCompetition(d.competition));

  useEffect(() => { load(); }, [id]);

  const onPlaceBet = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { bet } = await api.post('/bets', { betOptionId: selectedOptionId, stake: Number(stake) });
      navigate(`/better/my-bets/${bet.betCode}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!competition) return <div className="page">Loading...</div>;

  return (
    <>
      <TopBar title={competition.title} />
      <div className="page">
        <p className="muted">{competition.category} · Betting closes {new Date(competition.bettingDeadline).toLocaleString()}</p>
        {competition.description && <p>{competition.description}</p>}
        {competition.boardman && (
          <p className="muted">
            Run by {competition.boardman.name} · {competition.boardman.location}
            {competition.boardman.trustScore != null && <span className="trust-badge" style={{ marginLeft: 6 }}>Trust {competition.boardman.trustScore}</span>}
          </p>
        )}
        <p className="muted">Pool so far: ₦{Number(competition.pool.totalPool).toLocaleString()}</p>
        {competition.pool.notices.map((n) => (
          <div key={n.code} className="notice-banner">{n.message}</div>
        ))}

        <h2>Choose your bet</h2>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={onPlaceBet}>
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

          <button className="btn btn-primary" type="submit" disabled={!selectedOptionId || !stake || submitting}>
            {submitting ? 'Placing bet...' : 'Place Bet'}
          </button>
        </form>
      </div>
      <BottomNav role="BETTER" />
    </>
  );
}
