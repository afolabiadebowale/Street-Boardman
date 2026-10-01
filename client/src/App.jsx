import { Routes, Route } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';

import Landing from './routes/auth/Landing';
import Login from './routes/auth/Login';
import RegisterBetter from './routes/auth/RegisterBetter';
import RegisterBoardman from './routes/auth/RegisterBoardman';

import BetterHome from './routes/better/BetterHome';
import Competitions from './routes/better/Competitions';
import CompetitionDetail from './routes/better/CompetitionDetail';
import MyBets from './routes/better/MyBets';
import BetTicket from './routes/better/BetTicket';
import Wallet from './routes/better/Wallet';
import Deposit from './routes/better/Deposit';
import Withdraw from './routes/better/Withdraw';
import TransactionHistory from './routes/better/TransactionHistory';
import Profile from './routes/better/Profile';

import BoardmanDashboard from './routes/boardman/BoardmanDashboard';
import CreateCompetition from './routes/boardman/CreateCompetition';
import ActiveCompetitions from './routes/boardman/ActiveCompetitions';
import CompetitionManage from './routes/boardman/CompetitionManage';
import Revenue from './routes/boardman/Revenue';
import BoardmanWallet from './routes/boardman/BoardmanWallet';
import BoardmanWithdraw from './routes/boardman/BoardmanWithdraw';
import BoardmanProfile from './routes/boardman/BoardmanProfile';

import AdminOverview from './routes/admin/AdminOverview';
import Boardmen from './routes/admin/Boardmen';
import AdminCompetitions from './routes/admin/AdminCompetitions';
import Disputes from './routes/admin/Disputes';
import Settings from './routes/admin/Settings';
import Users from './routes/admin/Users';
import Ledger from './routes/admin/Ledger';
import AuditLogs from './routes/admin/AuditLogs';
import Security from './routes/admin/Security';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register/better" element={<RegisterBetter />} />
      <Route path="/register/boardman" element={<RegisterBoardman />} />

      <Route path="/better" element={<ProtectedRoute role="BETTER"><BetterHome /></ProtectedRoute>} />
      <Route path="/better/competitions" element={<ProtectedRoute role="BETTER"><Competitions /></ProtectedRoute>} />
      <Route path="/better/competitions/:id" element={<ProtectedRoute role="BETTER"><CompetitionDetail /></ProtectedRoute>} />
      <Route path="/better/my-bets" element={<ProtectedRoute role="BETTER"><MyBets /></ProtectedRoute>} />
      <Route path="/better/my-bets/:betCode" element={<ProtectedRoute role="BETTER"><BetTicket /></ProtectedRoute>} />
      <Route path="/better/wallet" element={<ProtectedRoute role="BETTER"><Wallet /></ProtectedRoute>} />
      <Route path="/better/deposit" element={<ProtectedRoute role="BETTER"><Deposit /></ProtectedRoute>} />
      <Route path="/better/withdraw" element={<ProtectedRoute role="BETTER"><Withdraw /></ProtectedRoute>} />
      <Route path="/better/transactions" element={<ProtectedRoute role="BETTER"><TransactionHistory /></ProtectedRoute>} />
      <Route path="/better/profile" element={<ProtectedRoute role="BETTER"><Profile /></ProtectedRoute>} />

      <Route path="/boardman" element={<ProtectedRoute role="BOARDMAN"><BoardmanDashboard /></ProtectedRoute>} />
      <Route path="/boardman/create" element={<ProtectedRoute role="BOARDMAN"><CreateCompetition /></ProtectedRoute>} />
      <Route path="/boardman/active" element={<ProtectedRoute role="BOARDMAN"><ActiveCompetitions /></ProtectedRoute>} />
      <Route path="/boardman/competitions/:id" element={<ProtectedRoute role="BOARDMAN"><CompetitionManage /></ProtectedRoute>} />
      <Route path="/boardman/revenue" element={<ProtectedRoute role="BOARDMAN"><Revenue /></ProtectedRoute>} />
      <Route path="/boardman/wallet" element={<ProtectedRoute role="BOARDMAN"><BoardmanWallet /></ProtectedRoute>} />
      <Route path="/boardman/withdraw" element={<ProtectedRoute role="BOARDMAN"><BoardmanWithdraw /></ProtectedRoute>} />
      <Route path="/boardman/profile" element={<ProtectedRoute role="BOARDMAN"><BoardmanProfile /></ProtectedRoute>} />

      <Route path="/admin" element={<ProtectedRoute role="ADMIN"><AdminOverview /></ProtectedRoute>} />
      <Route path="/admin/boardmen" element={<ProtectedRoute role="ADMIN"><Boardmen /></ProtectedRoute>} />
      <Route path="/admin/competitions" element={<ProtectedRoute role="ADMIN"><AdminCompetitions /></ProtectedRoute>} />
      <Route path="/admin/disputes" element={<ProtectedRoute role="ADMIN"><Disputes /></ProtectedRoute>} />
      <Route path="/admin/settings" element={<ProtectedRoute role="ADMIN"><Settings /></ProtectedRoute>} />
      <Route path="/admin/users" element={<ProtectedRoute role="ADMIN"><Users /></ProtectedRoute>} />
      <Route path="/admin/ledger" element={<ProtectedRoute role="ADMIN"><Ledger /></ProtectedRoute>} />
      <Route path="/admin/audit-logs" element={<ProtectedRoute role="ADMIN"><AuditLogs /></ProtectedRoute>} />
      <Route path="/admin/security" element={<ProtectedRoute role="ADMIN"><Security /></ProtectedRoute>} />

      <Route path="*" element={<Landing />} />
    </Routes>
  );
}
