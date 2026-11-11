import { useAuth } from '../../context/AuthContext';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Card } from '../../components/ui/card';
import { Page } from '../../components/ui/page';

export default function BoardmanProfile() {
  const { user, boardmanProfile } = useAuth();

  return (
    <>
      <TopBar title="Boardman Profile" />
      <Page>
        <Card>
          <p className="text-sm text-muted">Full name</p>
          <strong>{user?.fullName}</strong>
        </Card>
        <Card>
          <p className="text-sm text-muted">Phone number</p>
          <strong>{user?.phone}</strong>
        </Card>
        <Card>
          <p className="text-sm text-muted">Location</p>
          <strong>{boardmanProfile?.businessLocation}</strong>
        </Card>
        <Card>
          <p className="text-sm text-muted">Approval status</p>
          <strong>{boardmanProfile?.approvalStatus}</strong>
        </Card>
        {boardmanProfile?.commissionRateOverride != null && (
          <Card>
            <p className="text-sm text-muted">Your commission rate (set by Admin)</p>
            <strong>{(boardmanProfile.commissionRateOverride * 100).toFixed(1)}%</strong>
          </Card>
        )}
      </Page>
      <BottomNav role="BOARDMAN" />
    </>
  );
}
