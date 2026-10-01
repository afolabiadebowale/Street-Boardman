const prisma = require('../config/db');
const AppError = require('../utils/appError');
const walletService = require('./walletService');
const { toDecimal, round2 } = require('../utils/money');
const { recordAuditLog } = require('../middleware/auditLog');
const env = require('../config/env');

// Stands in for a real bank transfer via a payment provider's Transfers
// API, which belongs here once EPIC-003/FEAT-011 wires one up. Deliberately
// throws in PRODUCTION rather than silently doing nothing, so "processed"
// can never again be a status with no real money movement behind it
// (TASK-003). DEMO mode has no real transfer to make, so it no-ops.
async function transferFunds(withdrawal) {
  if (env.appMode === 'PRODUCTION') {
    throw new AppError(
      'Real bank transfers are not yet implemented (see FEAT-011) — cannot process this withdrawal',
      501
    );
  }
  return { success: true, reference: `demo-transfer:${withdrawal.id}` };
}

// Withdrawals are two-step: requesting one immediately debits the wallet
// (so the user can't spend the same money twice while it's "pending"), and
// an Admin/queue later marks it PROCESSED (money actually sent) or
// REJECTED (money returned to the wallet).
//
// Gated by KYC tier (TASK-027): TIER_0 (phone-verified only) cannot
// withdraw at all — only a BVN/NIN-matched TIER_1 account (TASK-026) can.
// Checked before anything else so an unverified user's wallet is never
// touched by a withdrawal attempt that was always going to be refused.
async function requestWithdrawal(userId, amount, destination) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { kycTier: true } });
  if (!user) throw new AppError('User not found', 404);
  if (user.kycTier !== 'TIER_1') {
    throw new AppError('Verify your BVN or NIN before you can withdraw', 403);
  }

  const amountDecimal = round2(toDecimal(amount));
  if (amountDecimal.lte(0)) throw new AppError('Withdrawal amount must be positive', 422);

  return prisma.$transaction(async (tx) => {
    const wallet = await walletService.getWalletByUserId(tx, userId);
    const withdrawal = await tx.withdrawal.create({
      data: { userId, amount: amountDecimal, destination, status: 'PENDING' },
    });
    await walletService.applyWalletTransaction(tx, {
      walletId: wallet.id,
      type: 'WITHDRAWAL',
      delta: amountDecimal.negated(),
      referenceType: 'Withdrawal',
      referenceId: withdrawal.id,
      note: 'Withdrawal request',
      counterparty: { type: 'EXTERNAL' },
    });
    return withdrawal;
  });
}

async function listWithdrawalsForUser(userId) {
  return prisma.withdrawal.findMany({ where: { userId }, orderBy: { requestedAt: 'desc' } });
}

// The status flip is the ONLY thing that decides whether a withdrawal gets
// processed or rejected. It's a single conditional update (PENDING -> new
// status) rather than a find-then-update, so two concurrent admin actions
// on the same withdrawal can never both succeed — whichever call loses the
// race finds updateMany matched 0 rows and gets a clean error instead of
// double-processing it (TASK-002).
async function processWithdrawal(withdrawalId, adminUserId) {
  const existing = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!existing) throw new AppError('Withdrawal not found', 404);
  if (existing.status !== 'PENDING') throw new AppError('Withdrawal already handled', 400);

  // Real money has to actually move before we're allowed to call this
  // done — see transferFunds above. The atomic claim below is still what
  // guards against a concurrent double-process (TASK-002); this is just
  // an early, read-only check to avoid attempting a transfer on a
  // withdrawal that's obviously already settled.
  await transferFunds(existing);

  return prisma.$transaction(async (tx) => {
    const claim = await tx.withdrawal.updateMany({
      where: { id: withdrawalId, status: 'PENDING' },
      data: { status: 'PROCESSED', processedAt: new Date() },
    });
    if (claim.count === 0) {
      const existing = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
      if (!existing) throw new AppError('Withdrawal not found', 404);
      throw new AppError('Withdrawal already handled', 400);
    }
    await recordAuditLog(
      {
        actorUserId: adminUserId,
        action: 'WITHDRAWAL_PROCESSED',
        entityType: 'Withdrawal',
        entityId: withdrawalId,
        beforeState: { status: 'PENDING' },
        afterState: { status: 'PROCESSED' },
      },
      tx
    );
    return tx.withdrawal.findUnique({ where: { id: withdrawalId } });
  });
}

// Rejecting a withdrawal returns the held funds to the user's wallet as an
// ADJUSTMENT, with a clear note — never a silent balance edit. The claim
// (conditional status update) runs first, inside the same transaction as
// the refund, so a losing concurrent call rolls back before it can touch
// the wallet at all.
async function rejectWithdrawal(withdrawalId, adminUserId, reasonNote) {
  return prisma.$transaction(async (tx) => {
    const claim = await tx.withdrawal.updateMany({
      where: { id: withdrawalId, status: 'PENDING' },
      data: { status: 'REJECTED', processedAt: new Date() },
    });
    if (claim.count === 0) {
      const existing = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
      if (!existing) throw new AppError('Withdrawal not found', 404);
      throw new AppError('Withdrawal already handled', 400);
    }

    const withdrawal = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
    const wallet = await walletService.getWalletByUserId(tx, withdrawal.userId);
    await walletService.applyWalletTransaction(tx, {
      walletId: wallet.id,
      type: 'ADJUSTMENT',
      delta: withdrawal.amount,
      referenceType: 'Withdrawal',
      referenceId: withdrawal.id,
      note: reasonNote || 'Withdrawal rejected — funds returned',
      // Reverses the WITHDRAWAL leg above, which also went to EXTERNAL —
      // the money never actually left (TASK-003's stub refuses to run a
      // real transfer), so crediting it back from the same counterparty
      // keeps the ledger consistent with what actually happened.
      counterparty: { type: 'EXTERNAL' },
    });
    await recordAuditLog(
      {
        actorUserId: adminUserId,
        action: 'WITHDRAWAL_REJECTED',
        entityType: 'Withdrawal',
        entityId: withdrawalId,
        beforeState: { status: 'PENDING' },
        afterState: { status: 'REJECTED', reason: reasonNote || null },
      },
      tx
    );
    return withdrawal;
  });
}

module.exports = { requestWithdrawal, listWithdrawalsForUser, processWithdrawal, rejectWithdrawal };
