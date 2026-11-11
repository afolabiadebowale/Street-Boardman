import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';

export default function TopBar({ title }) {
  const { t } = useTranslation('common');
  const { logout } = useAuth();
  const navigate = useNavigate();

  // Leave the protected page before clearing the user. Clearing it first
  // makes ProtectedRoute redirect to /login, racing this navigate — and
  // react-router 7 resolves that race differently from v6.
  const onLogout = async () => {
    navigate('/', { replace: true });
    await logout();
  };

  return (
    <header className="flex items-center justify-between bg-primary p-4 text-white">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:text-primary"
      >
        {t('skipToContent')}
      </a>
      <h1 className="m-0 text-[17px] font-bold">{title}</h1>
      <button className="border-none bg-transparent text-sm text-white" onClick={onLogout}>{t('logOut')}</button>
    </header>
  );
}
