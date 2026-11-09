import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';

export default function BoardmanPublicProfile() {
  const { id } = useParams();
  const [boardman, setBoardman] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/boardmen/${id}/public`)
      .then((d) => setBoardman(d.boardman))
      .catch((err) => setError(err.message));
  }, [id]);

  if (error) {
    return (
      <>
        <TopBar title="Boardman" />
        <div className="page">
          <div className="error-banner">{error}</div>
        </div>
        <BottomNav role="BETTER" />
      </>
    );
  }

  if (!boardman) return <div className="page">Loading...</div>;

  const { track } = boardman;

  return (
    <>
      <TopBar title={boardman.name} />
      <div className="page">
        <div className="card">
          <h2 style={{ marginBottom: 4 }}>{boardman.name}</h2>
          <p className="muted">{boardman.location}</p>
          {boardman.memberSince && (
            <p className="muted">Boardman since {new Date(boardman.memberSince).toLocaleDateString()}</p>
          )}
          {boardman.trustScore != null ? (
            <span className="trust-badge" style={{ marginTop: 8 }}>Trust {boardman.trustScore}</span>
          ) : (
            <p className="muted" style={{ marginTop: 8 }}>New Boardman — not enough settled competitions yet for a trust score.</p>
          )}
        </div>

        <div className="card">
          <p className="ticket-row"><span>Completed competitions</span><strong>{track.completedCompetitions}</strong></p>
          <p className="ticket-row"><span>Disputed</span><strong>{track.disputedCompetitions}</strong></p>
          <p className="ticket-row"><span>Results overturned</span><strong>{track.resultsOverturned}</strong></p>
          <p className="ticket-row"><span>Cancelled by Boardman</span><strong>{track.cancelledByBoardman}</strong></p>
          <p className="ticket-row"><span>Total staked on completed competitions</span><strong>₦{Number(track.totalStakedOnCompleted).toLocaleString()}</strong></p>
        </div>

        <p className="muted">{boardman.scoreExplained}</p>
      </div>
      <BottomNav role="BETTER" />
    </>
  );
}
