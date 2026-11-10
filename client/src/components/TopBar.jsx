import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function TopBar({ title }) {
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
    <div className="flex items-center justify-between bg-primary p-4 text-white">
      <strong>{title}</strong>
      <button className="border-none bg-transparent text-sm text-white" onClick={onLogout}>Log out</button>
    </div>
  );
}
