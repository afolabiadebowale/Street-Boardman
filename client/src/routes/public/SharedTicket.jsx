import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';

// Public (no auth, no TopBar/BottomNav) — reached via a link a Better
// shared. GET /tickets/:token (bettingService.getSharedTicket) never
// returns who placed the bet, only what and how it ended.
export default function SharedTicket() {
  const { t } = useTranslation('auth');
  const { token } = useParams();
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/tickets/${token}`)
      .then((d) => setTicket(d.ticket))
      .catch((err) => setError(err.message));
  }, [token]);

  if (error) {
    return (
      <div className="page">
        <h1>{t('sharedTicket.title')}</h1>
        <div className="error-banner" role="alert">{error}</div>
        <Link to="/" className="btn btn-primary" style={{ marginTop: 12 }}>{t('sharedTicket.goHome')}</Link>
      </div>
    );
  }

  if (!ticket) return <div className="page" role="status">{t('common:loading')}</div>;

  return (
    <div className="page">
      <h1>{t('sharedTicket.title')}</h1>
      <div className="ticket">
        <div className="ticket-row"><span>{t('sharedTicket.betId')}</span><strong>{ticket.betCode}</strong></div>
        <div className="ticket-row"><span>{t('sharedTicket.competition')}</span><strong>{ticket.competition.title}</strong></div>
        <div className="ticket-row"><span>{t('sharedTicket.selection')}</span><strong>{ticket.option}</strong></div>
        <div className="ticket-row"><span>{t('sharedTicket.stake')}</span><strong>₦{Number(ticket.stake).toLocaleString()}</strong></div>
        <div className="ticket-row"><span>{t('sharedTicket.status')}</span><strong>{ticket.status}</strong></div>
        {ticket.winningOption && (
          <div className="ticket-row"><span>{t('sharedTicket.result')}</span><strong>{ticket.winningOption}</strong></div>
        )}
      </div>
      <Link to="/" className="btn btn-primary" style={{ marginTop: 12 }}>{t('sharedTicket.join')}</Link>
    </div>
  );
}
