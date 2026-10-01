const asyncHandler = require('../utils/asyncHandler');
const prisma = require('../config/db');
const walletService = require('../services/walletService');

// Balance is read from the ledger, not trusted from the Wallet.balance
// column directly (TASK-018) — the two are kept in sync by
// applyWalletTransaction (TASK-017), but the ledger is the authoritative
// source once both exist.
const getMyWallet = asyncHandler(async (req, res) => {
  const wallet = await walletService.getWalletByUserId(prisma, req.user.id);
  const balance = await walletService.getLedgerDerivedBalance(prisma, wallet.id);
  res.json({ wallet: { ...wallet, balance } });
});

const getMyTransactions = asyncHandler(async (req, res) => {
  const wallet = await walletService.getWalletByUserId(prisma, req.user.id);
  const transactions = await prisma.walletTransaction.findMany({
    where: { walletId: wallet.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ transactions });
});

module.exports = { getMyWallet, getMyTransactions };
