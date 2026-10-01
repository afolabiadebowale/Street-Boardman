const asyncHandler = require('../utils/asyncHandler');
const prisma = require('../config/db');
const adminService = require('../services/adminService');
const settingsService = require('../services/settingsService');
const resultService = require('../services/resultService');
const { STAFF_VISIBLE_USER_FIELDS } = require('../utils/userSelect');

const listPendingBoardmen = asyncHandler(async (req, res) => {
  res.json({ boardmen: await adminService.listPendingBoardmen() });
});

const listAllBoardmen = asyncHandler(async (req, res) => {
  res.json({ boardmen: await adminService.listAllBoardmen() });
});

const approveBoardman = asyncHandler(async (req, res) => {
  const boardman = await adminService.approveBoardman(req.params.id, req.user.id);
  res.json({ boardman });
});

const rejectBoardman = asyncHandler(async (req, res) => {
  const boardman = await adminService.rejectBoardman(req.params.id, req.user.id, req.body.reason);
  res.json({ boardman });
});

const suspendBoardman = asyncHandler(async (req, res) => {
  const boardman = await adminService.suspendBoardman(req.params.id, req.user.id);
  res.json({ boardman });
});

const listUsers = asyncHandler(async (req, res) => {
  res.json({ users: await adminService.listUsers() });
});

const suspendUser = asyncHandler(async (req, res) => {
  const user = await adminService.suspendUser(req.params.id, req.user.id);
  res.json({ user });
});

const reactivateUser = asyncHandler(async (req, res) => {
  const user = await adminService.reactivateUser(req.params.id, req.user.id);
  res.json({ user });
});

const setStaffRole = asyncHandler(async (req, res) => {
  const user = await adminService.setStaffRole(req.params.id, req.body.staffRole, req.user.id);
  res.json({ user });
});

const listCompetitions = asyncHandler(async (req, res) => {
  const competitions = await prisma.competition.findMany({
    include: {
      betOptions: true,
      result: true,
      boardmanProfile: { include: { user: { select: STAFF_VISIBLE_USER_FIELDS } } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ competitions });
});

const listBets = asyncHandler(async (req, res) => {
  const bets = await prisma.bet.findMany({
    include: { better: { select: { fullName: true, phone: true } }, betOption: { include: { competition: true } } },
    orderBy: { placedAt: 'desc' },
    take: 200,
  });
  res.json({ bets });
});

const listDisputes = asyncHandler(async (req, res) => {
  const disputes = await prisma.dispute.findMany({
    include: { competition: true, raisedByUser: { select: { fullName: true, phone: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ disputes });
});

const resolveDispute = asyncHandler(async (req, res) => {
  const outcome = await resultService.resolveDispute(req.user.id, req.params.id, req.body);
  res.json({ outcome });
});

const getLedger = asyncHandler(async (req, res) => {
  res.json({ transactions: await adminService.getFinancialLedger() });
});

const getAuditLogs = asyncHandler(async (req, res) => {
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  res.json({ logs });
});

const getSettings = asyncHandler(async (req, res) => {
  res.json({ settings: await settingsService.getAllSettings() });
});

const updateSettings = asyncHandler(async (req, res) => {
  const entries = Object.entries(req.body);
  for (const [key, value] of entries) {
    await settingsService.updateSetting(key, value, req.user.id);
  }
  res.json({ settings: await settingsService.getAllSettings() });
});

const getOverview = asyncHandler(async (req, res) => {
  const [userCount, boardmanCount, competitionCount, betCount, platformWallet] = await Promise.all([
    prisma.user.count({ where: { role: 'BETTER' } }),
    prisma.boardmanProfile.count(),
    prisma.competition.count(),
    prisma.bet.count(),
    prisma.wallet.findFirst({ where: { walletType: 'PLATFORM' } }),
  ]);
  res.json({
    userCount,
    boardmanCount,
    competitionCount,
    betCount,
    platformRevenue: platformWallet?.balance ?? 0,
  });
});

module.exports = {
  listPendingBoardmen,
  listAllBoardmen,
  approveBoardman,
  rejectBoardman,
  suspendBoardman,
  listUsers,
  suspendUser,
  reactivateUser,
  setStaffRole,
  listCompetitions,
  listBets,
  listDisputes,
  resolveDispute,
  getLedger,
  getAuditLogs,
  getSettings,
  updateSettings,
  getOverview,
};
