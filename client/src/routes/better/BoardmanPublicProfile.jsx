import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Page } from '../../components/ui/page';

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
        <Page>
          <div className="error-banner" role="alert">{error}</div>
        </Page>
        <BottomNav role="BETTER" />
      </>
    );
  }

  if (!boardman) return <Page role="status">Loading...</Page>;

  const { track } = boardman;

  return (
    <>
      <TopBar title={boardman.name} />
      <Page>
        <Card>
          <h2 className="mb-1">{boardman.name}</h2>
          <p className="text-sm text-muted">{boardman.location}</p>
          {boardman.memberSince && (
            <p className="text-sm text-muted">Boardman since {new Date(boardman.memberSince).toLocaleDateString()}</p>
          )}
          {boardman.trustScore != null ? (
            <Badge variant="trust" className="mt-2">Trust {boardman.trustScore}</Badge>
          ) : (
            <p className="mt-2 text-sm text-muted">New Boardman — not enough settled competitions yet for a trust score.</p>
          )}
        </Card>

        <Card>
          <p className="mb-1.5 flex justify-between text-[15px]"><span>Completed competitions</span><strong>{track.completedCompetitions}</strong></p>
          <p className="mb-1.5 flex justify-between text-[15px]"><span>Disputed</span><strong>{track.disputedCompetitions}</strong></p>
          <p className="mb-1.5 flex justify-between text-[15px]"><span>Results overturned</span><strong>{track.resultsOverturned}</strong></p>
          <p className="mb-1.5 flex justify-between text-[15px]"><span>Cancelled by Boardman</span><strong>{track.cancelledByBoardman}</strong></p>
          <p className="mb-1.5 flex justify-between text-[15px]"><span>Total staked on completed competitions</span><strong>₦{Number(track.totalStakedOnCompleted).toLocaleString()}</strong></p>
        </Card>

        <p className="text-sm text-muted">{boardman.scoreExplained}</p>
      </Page>
      <BottomNav role="BETTER" />
    </>
  );
}
