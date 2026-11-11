import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Button } from '../../components/ui/button';
import { Input, Select, Textarea } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Page } from '../../components/ui/page';

const CATEGORIES = ['FOOTBALL', 'SNOOKER', 'FIGHT', 'TABLE_GAME', 'OTHER'];

function toLocalDatetimeInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function CreateCompetition() {
  const { t } = useTranslation('boardman');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('FOOTBALL');
  const [description, setDescription] = useState('');
  const [participantA, setParticipantA] = useState('');
  const [participantB, setParticipantB] = useState('');
  const [bettingDeadline, setBettingDeadline] = useState(
    toLocalDatetimeInputValue(new Date(Date.now() + 3 * 60 * 60 * 1000))
  );
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { competition } = await api.post('/competitions', {
        title,
        category,
        description,
        bettingDeadline: new Date(bettingDeadline).toISOString(),
        participants: [participantA, participantB].filter(Boolean),
        options: [`${participantA} wins`, `${participantB} wins`],
      });
      navigate(`/boardman/active`, { state: { createdId: competition.id } });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <TopBar title={t('createCompetition.title')} />
      <Page>
        {error && <div className="error-banner" role="alert">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="mb-4">
            <Label htmlFor="comp-title">{t('createCompetition.titleLabel')}</Label>
            <Input id="comp-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('createCompetition.titlePlaceholder')} required />
          </div>
          <div className="mb-4">
            <Label htmlFor="comp-category">{t('createCompetition.categoryLabel')}</Label>
            <Select id="comp-category" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
            </Select>
          </div>
          <div className="mb-4">
            <Label htmlFor="comp-participant-a">{t('createCompetition.participantALabel')}</Label>
            <Input id="comp-participant-a" value={participantA} onChange={(e) => setParticipantA(e.target.value)} placeholder={t('createCompetition.participantAPlaceholder')} required />
          </div>
          <div className="mb-4">
            <Label htmlFor="comp-participant-b">{t('createCompetition.participantBLabel')}</Label>
            <Input id="comp-participant-b" value={participantB} onChange={(e) => setParticipantB(e.target.value)} placeholder={t('createCompetition.participantBPlaceholder')} required />
          </div>
          <div className="mb-4">
            <Label htmlFor="comp-deadline">{t('createCompetition.deadlineLabel')}</Label>
            <Input id="comp-deadline" type="datetime-local" value={bettingDeadline} onChange={(e) => setBettingDeadline(e.target.value)} required />
          </div>
          <div className="mb-4">
            <Label htmlFor="comp-notes">{t('createCompetition.notesLabel')}</Label>
            <Textarea id="comp-notes" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting ? t('createCompetition.creating') : t('createCompetition.submit')}
          </Button>
        </form>
      </Page>
      <BottomNav role="BOARDMAN" />
    </>
  );
}
