import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Card } from '../../components/ui/card';
import { Page } from '../../components/ui/page';

export default function BoardmanProfile() {
  const { t } = useTranslation('boardman');
  const { user, boardmanProfile } = useAuth();

  return (
    <>
      <TopBar title={t('profile.title')} />
      <Page>
        <Card>
          <p className="text-sm text-muted">{t('profile.fullName')}</p>
          <strong>{user?.fullName}</strong>
        </Card>
        <Card>
          <p className="text-sm text-muted">{t('profile.phoneNumber')}</p>
          <strong>{user?.phone}</strong>
        </Card>
        <Card>
          <p className="text-sm text-muted">{t('profile.location')}</p>
          <strong>{boardmanProfile?.businessLocation}</strong>
        </Card>
        <Card>
          <p className="text-sm text-muted">{t('profile.approvalStatus')}</p>
          <strong>{boardmanProfile?.approvalStatus}</strong>
        </Card>
        {boardmanProfile?.commissionRateOverride != null && (
          <Card>
            <p className="text-sm text-muted">{t('profile.commissionRate')}</p>
            <strong>{(boardmanProfile.commissionRateOverride * 100).toFixed(1)}%</strong>
          </Card>
        )}
      </Page>
      <BottomNav role="BOARDMAN" />
    </>
  );
}
