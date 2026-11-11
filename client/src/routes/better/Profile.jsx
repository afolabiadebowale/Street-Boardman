import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import TopBar from '../../components/TopBar';
import BottomNav from '../../components/BottomNav';
import { Card } from '../../components/ui/card';
import { Page } from '../../components/ui/page';

export default function Profile() {
  const { t } = useTranslation('better');
  const { user } = useAuth();

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
          <p className="text-sm text-muted">{t('profile.accountStatus')}</p>
          <strong>{user?.status}</strong>
        </Card>
        <Card>
          <p className="text-sm text-muted">{t('profile.needHelp')}</p>
          <p>{t('profile.helpText')}</p>
        </Card>
      </Page>
      <BottomNav role="BETTER" />
    </>
  );
}
