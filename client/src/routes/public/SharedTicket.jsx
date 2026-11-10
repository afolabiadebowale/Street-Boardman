import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../api/client';

// Public (no auth, no TopBar/BottomNav) — reached via a link a Better
// shared. GET /tickets/:token (bettingService.getSharedTicket) never
// returns who placed the bet, only what and how it ended.
export default function SharedTicket() {
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
        <h1>StreetBoardman</h1>
        <div className="error-banner">{error}</div>
        <Link to="/" className="btn btn-primary" style={{ marginTop: 12 }}>Go to StreetBoardman</Link>
      </div>
    );
  }

  if (!ticket) return <div className="page">Loading...</div>;

  return (
    <div className="page">
      <h1>StreetBoardman</h1>
      <div className="ticket">
        <div className="ticket-row"><span>BET ID</span><strong>{ticket.betCode}</strong></div>
        <div className="ticket-row"><span>Competition</span><strong>{ticket.competition.title}</strong></div>
        <div className="ticket-row"><span>Selection</span><strong>{ticket.option}</strong></div>
        <div className="ticket-row"><span>Stake</span><strong>₦{Number(ticket.stake).toLocaleString()}</strong></div>
        <div className="ticket-row"><span>Status</span><strong>{ticket.status}</strong></div>
        {ticket.winningOption && (
          <div className="ticket-row"><span>Result</span><strong>{ticket.winningOption}</strong></div>
        )}
      </div>
      <Link to="/" className="btn btn-primary" style={{ marginTop: 12 }}>Join StreetBoardman</Link>
    </div>
  );
}
