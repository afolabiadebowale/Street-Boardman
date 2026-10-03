import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';

import Landing from './routes/auth/Landing';
import Login from './routes/auth/Login';
import RegisterBetter from './routes/auth/RegisterBetter';
import RegisterBoardman from './routes/auth/RegisterBoardman';

// Each role's screens are one lazily loaded chunk: a bettor on mobile data
// never downloads the Boardman or admin screens. Auth screens stay in the
// main bundle, since that's where everyone starts.
const fromRole = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));
const better = () => import('./routes/better');
const boardman = () => import('./routes/boardman');
const admin = () => import('./routes/admin');

const BetterHome = fromRole(better, 'BetterHome');
const Competitions = fromRole(better, 'Competitions');
const CompetitionDetail = fromRole(better, 'CompetitionDetail');
const MyBets = fromRole(better, 'MyBets');
const BetTicket = fromRole(better, 'BetTicket');
const Wallet = fromRole(better, 'Wallet');
const Deposit = fromRole(better, 'Deposit');
const Withdraw = fromRole(better, 'Withdraw');
const TransactionHistory = fromRole(better, 'TransactionHistory');
const Profile = fromRole(better, 'Profile');
const BoardmanDashboard = fromRole(boardman, 'BoardmanDashboard');
const CreateCompetition = fromRole(boardman, 'CreateCompetition');
const ActiveCompetitions = fromRole(boardman, 'ActiveCompetitions');
const CompetitionManage = fromRole(boardman, 'CompetitionManage');
const Revenue = fromRole(boardman, 'Revenue');
const BoardmanWallet = fromRole(boardman, 'BoardmanWallet');
const BoardmanWithdraw = fromRole(boardman, 'BoardmanWithdraw');
const BoardmanProfile = fromRole(boardman, 'BoardmanProfile');
const AdminOverview = fromRole(admin, 'AdminOverview');
const Boardmen = fromRole(admin, 'Boardmen');
const AdminCompetitions = fromRole(admin, 'AdminCompetitions');
const Disputes = fromRole(admin, 'Disputes');
const Settings = fromRole(admin, 'Settings');
const Users = fromRole(admin, 'Users');
const Ledger = fromRole(admin, 'Ledger');
const AuditLogs = fromRole(admin, 'AuditLogs');
const Security = fromRole(admin, 'Security');

export default function App() {
  return (
    <Suspense fallback={<div className="page-loading">Loading...</div>}>
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
    </Suspense>
  );
}
