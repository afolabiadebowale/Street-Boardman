import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input, Textarea } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Page } from '../../components/ui/page';

export default function BetTicket() {
  const { t } = useTranslation('better');
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

  if (!bet) return <Page role="status">{t('common:loading')}</Page>;

  const dispute = bet.betOption.competition.disputes?.[0];
  // Matches resultService.raiseDispute: only possible while the Boardman's
  // submitted result is awaiting confirmation, same window the auto-confirm
  // sweep respects (see docs/ARCHITECTURE.md section 10), and only while no
  // dispute already exists on this competition.
  const canDispute = bet.betOption.competition.status === 'PENDING_CONFIRMATION' && !dispute;

  return (
    <>
      <TopBar title={t('betTicket.title')} />
      <Page>
        <div className="rounded-md border-2 border-dashed border-primary bg-surface p-5 font-mono">
          <div className="mb-1.5 flex justify-between text-[15px]"><span>{t('betTicket.betId')}</span><strong>{bet.betCode}</strong></div>
          <div className="mb-1.5 flex justify-between text-[15px]"><span>{t('betTicket.competition')}</span><strong>{bet.betOption.competition.title}</strong></div>
          <div className="mb-1.5 flex justify-between text-[15px]"><span>{t('betTicket.selection')}</span><strong>{bet.betOption.label}</strong></div>
          <div className="mb-1.5 flex justify-between text-[15px]"><span>{t('betTicket.stake')}</span><strong>₦{Number(bet.stake).toLocaleString()}</strong></div>
          <div className="mb-1.5 flex justify-between text-[15px]"><span>{t('betTicket.estimatedPayout')}</span><strong>₦{Number(bet.potentialPayout).toLocaleString()}</strong></div>
          <div data-testid="ticket-status-row" className="mb-1.5 flex justify-between text-[15px]"><span>{t('betTicket.status')}</span><strong>{bet.status}</strong></div>
        </div>
        <p className="mt-3 text-sm text-muted">
          {t('betTicket.payoutNotice')}
        </p>

        {canDispute && (
          <Card className="mt-3">
            <h2>{t('betTicket.disputeTitle')}</h2>
            <p className="text-sm text-muted">
              {t('betTicket.disputeHint')}
            </p>
            {error && <div className="error-banner" role="alert">{error}</div>}
            <form onSubmit={onRaiseDispute}>
              <div className="mb-4">
                <Label htmlFor="dispute-reason">{t('betTicket.reasonLabel')}</Label>
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
                {submitting ? t('betTicket.reporting') : t('betTicket.reportProblem')}
              </Button>
            </form>
          </Card>
        )}
        {dispute && (
          <div className="success-banner mt-3" role="status">
            {t(`betTicket.disputeStatus.${dispute.status}`, {
              defaultValue: t('betTicket.disputeStatusFallback', { status: dispute.status }),
            })}
          </div>
        )}

        <Card className="mt-3">
          <h2>{t('betTicket.shareTitle')}</h2>
          <p className="text-sm text-muted">{t('betTicket.shareHint')}</p>
          {shareError && <div className="error-banner" role="alert">{shareError}</div>}
          {shareUrl ? (
            <div className="mb-4">
              <Label htmlFor="share-url">{t('betTicket.shareableLinkLabel')}</Label>
              <Input id="share-url" value={shareUrl} readOnly onFocus={(e) => e.target.select()} />
              <Button variant="secondary" type="button" onClick={onCopy} className="mt-2">
                {copied ? t('betTicket.copied') : t('betTicket.copyLink')}
              </Button>
            </div>
          ) : (
            <Button variant="secondary" type="button" onClick={onShare} disabled={sharing}>
              {sharing ? t('betTicket.gettingLink') : t('betTicket.getLink')}
            </Button>
          )}
        </Card>

        <Button asChild variant="secondary">
          <Link to="/better/my-bets">{t('betTicket.backToMyBets')}</Link>
        </Button>
      </Page>
      <BottomNav role="BETTER" />
    </>
  );
}
