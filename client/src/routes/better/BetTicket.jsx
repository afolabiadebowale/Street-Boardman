import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';

// FEAT-040: a dispute's status comes from the server (bettingService.getBetByCode
// now includes it), not local component state — so it's still visible here
// if the Better raised it, navigated away, and comes back days later.
const DISPUTE_STATUS_MESSAGE = {
  OPEN: 'Dispute raised. Payouts are frozen until a Platform Admin reviews it.',
  UNDER_REVIEW: 'A Platform Admin is reviewing this dispute. Payouts stay frozen until they decide.',
  RESOLVED_CONFIRMED: 'An Admin reviewed this dispute and confirmed the result — payouts have been processed.',
  RESOLVED_CANCELLED: 'An Admin reviewed this dispute and cancelled the competition — your stake was refunded.',
};

export default function BetTicket() {
  const { betCode } = useParams();
  const [bet, setBet] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = () => api.get(`/bets/${betCode}`).then((d) => setBet(d.bet));

  useEffect(() => {
    load();
  }, [betCode]);

  const onRaiseDispute = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post(`/competitions/${bet.betOption.competition.id}/dispute`, { reason });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!bet) return <div className="page">Loading...</div>;

  const dispute = bet.betOption.competition.disputes?.[0];
  // Matches resultService.raiseDispute: only possible while the Boardman's
  // submitted result is awaiting confirmation, same window the auto-confirm
  // sweep respects (see docs/ARCHITECTURE.md section 10), and only while no
  // dispute already exists on this competition.
  const canDispute = bet.betOption.competition.status === 'PENDING_CONFIRMATION' && !dispute;

  return (
    <>
      <TopBar title="Bet Ticket" />
      <div className="page">
        <div className="ticket">
          <div className="ticket-row"><span>BET ID</span><strong>{bet.betCode}</strong></div>
          <div className="ticket-row"><span>Competition</span><strong>{bet.betOption.competition.title}</strong></div>
          <div className="ticket-row"><span>Selection</span><strong>{bet.betOption.label}</strong></div>
          <div className="ticket-row"><span>Stake</span><strong>₦{Number(bet.stake).toLocaleString()}</strong></div>
          <div className="ticket-row"><span>Estimated payout</span><strong>₦{Number(bet.potentialPayout).toLocaleString()}</strong></div>
          <div className="ticket-row"><span>Status</span><strong>{bet.status}</strong></div>
        </div>
        <p className="muted" style={{ marginTop: 12 }}>
          The estimated payout can change until betting closes — it depends on how much everyone else stakes.
          Your final winnings are confirmed once the result is settled.
        </p>

        {canDispute && (
          <div className="card" style={{ marginTop: 12 }}>
            <h2>See a problem with this result?</h2>
            <p className="muted">
              The Boardman has submitted a result. If you think it's wrong, report it now — once an Admin
              reviews it, no automatic payout happens until they decide.
            </p>
            {error && <div className="error-banner">{error}</div>}
            <form onSubmit={onRaiseDispute}>
              <div className="field">
                <label htmlFor="dispute-reason">What's wrong?</label>
                <textarea
                  id="dispute-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  minLength={5}
                  required
                />
              </div>
              <button className="btn btn-danger" type="submit" disabled={submitting}>
                {submitting ? 'Reporting...' : 'Report a Problem'}
              </button>
            </form>
          </div>
        )}
        {dispute && (
          <div className="success-banner" style={{ marginTop: 12 }}>
            {DISPUTE_STATUS_MESSAGE[dispute.status] || `Dispute status: ${dispute.status}`}
          </div>
        )}

        <Link to="/better/my-bets" className="btn btn-secondary">Back to My Bets</Link>
      </div>
      <BottomNav role="BETTER" />
    </>
  );
}
