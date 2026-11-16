import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';
import { Page } from '../../components/ui/page';

export default function CompetitionDetail() {
  const { t } = useTranslation('better');
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

  if (!competition) return <Page role="status">{t('common:loading')}</Page>;

  const selectedOption = competition.betOptions.find((o) => o.id === selectedOptionId);
  const bettingOpen = competition.status === 'BETTING_OPEN';

  if (reviewing) {
    return (
      <>
        <TopBar title={competition.title} />
        <Page>
          <h2>{t('competitionDetail.confirmTitle')}</h2>
          {error && <div className="error-banner" role="alert">{error}</div>}
          <Card>
            <p className="mb-1.5 flex justify-between text-[15px]"><span>{t('competitionDetail.competition')}</span><span>{competition.title}</span></p>
            <p className="mb-1.5 flex justify-between text-[15px]"><span>{t('competitionDetail.yourPick')}</span><span>{selectedOption?.label}</span></p>
            <p className="mb-1.5 flex justify-between text-[15px]"><span>{t('competitionDetail.stake')}</span><span>₦{Number(stake).toLocaleString()}</span></p>
          </Card>
          <p className="text-sm text-muted">{t('competitionDetail.potNotice')}</p>
          <Button variant="primary" type="button" onClick={onConfirm} disabled={submitting} className="mt-4">
            {submitting ? t('competitionDetail.placingBet') : t('competitionDetail.confirmBet')}
          </Button>
          <Button variant="secondary" type="button" onClick={() => setReviewing(false)} disabled={submitting} className="mt-2">
            {t('competitionDetail.edit')}
          </Button>
        </Page>
        <BottomNav role="BETTER" />
      </>
    );
  }

  return (
    <>
      <TopBar title={competition.title} />
      <Page>
        <p className="text-sm text-muted">{t('competitionDetail.closes', { category: competition.category, date: new Date(competition.bettingDeadline).toLocaleString() })}</p>
        {competition.description && <p>{competition.description}</p>}
        {competition.boardman && (
          <p className="text-sm text-muted">
            {t('competitionDetail.runBy')} <Link to={`/better/boardmen/${competition.boardman.profileId}`}>{competition.boardman.name}</Link> · {competition.boardman.location}
            {competition.boardman.trustScore != null && <Badge variant="trust" className="ml-1.5">{t('competitionDetail.trust', { score: competition.boardman.trustScore })}</Badge>}
          </p>
        )}
        <p className="text-sm text-muted">{t('competitionDetail.poolSoFar', { pool: Number(competition.pool.totalPool).toLocaleString() })}</p>
        {bettingOpen && <p className="text-sm text-muted">{t('competitionDetail.potNotice')}</p>}
        {competition.pool.notices.map((n) => (
          <div key={n.code} className="mb-4 rounded-[10px] bg-[#fff4e0] p-3 text-sm text-[#8a5b00]">{n.message}</div>
        ))}

        <h2>{t('competitionDetail.chooseBet')}</h2>
        {error && <div className="error-banner" role="alert">{error}</div>}
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
                  {/* While betting is open, no confident number is shown — just
                      the pot notice above. Once closed, the rate is final. */}
                  {!bettingOpen && odds?.payoutPer100 && (
                    <span className="text-sm text-muted">{t('competitionDetail.lockedPayoutPer100', { payout: odds.payoutPer100 })}</span>
                  )}
                </label>
              </Card>
            );
          })}

          <div className="mb-4 mt-4">
            <Label htmlFor="bet-stake">{t('competitionDetail.stakeLabel')}</Label>
            <Input
              id="bet-stake"
              type="number"
              min="100"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              placeholder={t('competitionDetail.stakePlaceholder')}
              required
            />
          </div>

          <Button variant="primary" type="submit" disabled={!selectedOptionId || !stake}>
            {t('competitionDetail.reviewBet')}
          </Button>
        </form>
      </Page>
      <BottomNav role="BETTER" />
    </>
  );
}
