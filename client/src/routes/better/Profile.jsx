import { useAuth } from '../../context/AuthContext';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Card } from '../../components/ui/card';
import { Page } from '../../components/ui/page';

export default function Profile() {
  const { user } = useAuth();

  return (
    <>
      <TopBar title="Profile" />
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
          <p className="text-sm text-muted">Account status</p>
          <strong>{user?.status}</strong>
        </Card>
        <Card>
          <p className="text-sm text-muted">Need help?</p>
          <p>Contact support through your Boardman, or reach the platform support line listed in the app footer.</p>
        </Card>
      </Page>
      <BottomNav role="BETTER" />
    </>
  );
}
