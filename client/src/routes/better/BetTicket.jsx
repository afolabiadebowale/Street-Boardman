import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input, Textarea } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Page } from '../../components/ui/page';

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
  const [shareUrl, setShareUrl] = useState('');
  const [shareError, setShareError] = useState('');
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = () => api.get(`/bets/${betCode}`).then((d) => setBet(d.bet));

  useEffect(() => {
    load();
  }, [betCode]);

  const onShare = async () => {
    setShareError('');
    setSharing(true);
    try {
      const { path } = await api.post(`/bets/${betCode}/share`);
      setShareUrl(`${window.location.origin}${path}`);
    } catch (err) {
      setShareError(err.message);
    } finally {
      setSharing(false);
    }
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      // Clipboard permission can be denied — the link is still selectable
      // in the input, so this isn't fatal.
    }
  };

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

  if (!bet) return <Page role="status">Loading...</Page>;

  const dispute = bet.betOption.competition.disputes?.[0];
  // Matches resultService.raiseDispute: only possible while the Boardman's
  // submitted result is awaiting confirmation, same window the auto-confirm
  // sweep respects (see docs/ARCHITECTURE.md section 10), and only while no
  // dispute already exists on this competition.
  const canDispute = bet.betOption.competition.status === 'PENDING_CONFIRMATION' && !dispute;

  return (
    <>
      <TopBar title="Bet Ticket" />
      <Page>
        <div className="rounded-md border-2 border-dashed border-primary bg-surface p-5 font-mono">
          <div className="mb-1.5 flex justify-between text-[15px]"><span>BET ID</span><strong>{bet.betCode}</strong></div>
          <div className="mb-1.5 flex justify-between text-[15px]"><span>Competition</span><strong>{bet.betOption.competition.title}</strong></div>
          <div className="mb-1.5 flex justify-between text-[15px]"><span>Selection</span><strong>{bet.betOption.label}</strong></div>
          <div className="mb-1.5 flex justify-between text-[15px]"><span>Stake</span><strong>₦{Number(bet.stake).toLocaleString()}</strong></div>
          <div className="mb-1.5 flex justify-between text-[15px]"><span>Estimated payout</span><strong>₦{Number(bet.potentialPayout).toLocaleString()}</strong></div>
          <div data-testid="ticket-status-row" className="mb-1.5 flex justify-between text-[15px]"><span>Status</span><strong>{bet.status}</strong></div>
        </div>
        <p className="mt-3 text-sm text-muted">
          The estimated payout can change until betting closes — it depends on how much everyone else stakes.
          Your final winnings are confirmed once the result is settled.
        </p>

        {canDispute && (
          <Card className="mt-3">
            <h2>See a problem with this result?</h2>
            <p className="text-sm text-muted">
              The Boardman has submitted a result. If you think it's wrong, report it now — once an Admin
              reviews it, no automatic payout happens until they decide.
            </p>
            {error && <div className="error-banner" role="alert">{error}</div>}
            <form onSubmit={onRaiseDispute}>
              <div className="mb-4">
                <Label htmlFor="dispute-reason">What's wrong?</Label>
                <Textarea
                  id="dispute-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  minLength={5}
                  required
                />
              </div>
              <Button variant="destructive" type="submit" disabled={submitting}>
                {submitting ? 'Reporting...' : 'Report a Problem'}
              </Button>
            </form>
          </Card>
        )}
        {dispute && (
          <div className="success-banner mt-3" role="status">
            {DISPUTE_STATUS_MESSAGE[dispute.status] || `Dispute status: ${dispute.status}`}
          </div>
        )}

        <Card className="mt-3">
          <h2>Share this ticket</h2>
          <p className="text-sm text-muted">Anyone with the link can see what was bet and how it ended — never who placed it.</p>
          {shareError && <div className="error-banner" role="alert">{shareError}</div>}
          {shareUrl ? (
            <div className="mb-4">
              <Label htmlFor="share-url">Shareable link</Label>
              <Input id="share-url" value={shareUrl} readOnly onFocus={(e) => e.target.select()} />
              <Button variant="secondary" type="button" onClick={onCopy} className="mt-2">
                {copied ? 'Copied!' : 'Copy link'}
              </Button>
            </div>
          ) : (
            <Button variant="secondary" type="button" onClick={onShare} disabled={sharing}>
              {sharing ? 'Getting link...' : 'Get a shareable link'}
            </Button>
          )}
        </Card>

        <Button asChild variant="secondary">
          <Link to="/better/my-bets">Back to My Bets</Link>
        </Button>
      </Page>
      <BottomNav role="BETTER" />
    </>
  );
}
