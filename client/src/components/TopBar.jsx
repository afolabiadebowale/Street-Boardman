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
    <div className="top-bar">
      <strong>{title}</strong>
      <button onClick={onLogout}>Log out</button>
    </div>
  );
}
