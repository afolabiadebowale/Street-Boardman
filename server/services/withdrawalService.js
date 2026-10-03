const prisma = require('../config/db');
const AppError = require('../utils/appError');
const walletService = require('./walletService');
const { toDecimal, round2 } = require('../utils/money');
const { recordAuditLog } = require('../middleware/auditLog');
const env = require('../config/env');
const paystack = require('./paystackClient');
const logger = require('../utils/logger');
const errorTracking = require('../utils/errorTracking');

// Deterministic per withdrawal, so a retry can never create a second
// transfer at Paystack (it refuses duplicate references).
function transferReferenceFor(withdrawalId) {
  return `wd_${withdrawalId}`;
}

function toKobo(amount) {
  return Number(round2(toDecimal(amount)).times(100).toFixed(0));
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
  // A real transfer needs the bank's code, not its display name. Checked
  // before the wallet is debited, so a request that could never be paid
  // out never holds the user's money (TASK-021).
  if (env.appMode === 'PRODUCTION' && !destination?.bankCode) {
    throw new AppError('Choose your bank from the list so we can send the transfer', 422);
  }

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

// Paying out is claim-first: PENDING -> PROCESSING is one conditional
// update, so of two concurrent admin clicks only one ever reaches Paystack
// (TASK-002). The transfer then runs outside any transaction (it's a slow
// network call) and Paystack's webhook, or confirmStuckTransfers below if
// the webhook never arrives, settles it as PROCESSED or FAILED (TASK-021).
// DEMO mode has no money to move, so it settles straight away.
async function processWithdrawal(withdrawalId, adminUserId) {
  const existing = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!existing) throw new AppError('Withdrawal not found', 404);
  if (existing.status !== 'PENDING') throw new AppError('Withdrawal already handled', 400);

  if (env.appMode === 'PRODUCTION') {
    if (!env.paystack.secretKey) {
      throw new AppError('Real bank transfers need PAYSTACK_SECRET_KEY — cannot process this withdrawal', 501);
    }
    await assertFloatCovers(existing);
  }

  const claim = await prisma.withdrawal.updateMany({
    where: { id: withdrawalId, status: 'PENDING' },
    data: {
      status: 'PROCESSING',
      transferReference: transferReferenceFor(withdrawalId),
      transferInitiatedAt: new Date(),
      failureReason: null,
    },
  });
  if (claim.count === 0) throw new AppError('Withdrawal already handled', 400);
  await recordAuditLog({
    actorUserId: adminUserId,
    action: 'WITHDRAWAL_TRANSFER_STARTED',
    entityType: 'Withdrawal',
    entityId: withdrawalId,
    beforeState: { status: 'PENDING' },
    afterState: { status: 'PROCESSING' },
  });

  if (env.appMode !== 'PRODUCTION') {
    return settleTransferSucceeded(withdrawalId, {
      transferCode: `demo-transfer:${withdrawalId}`,
      actorUserId: adminUserId,
    });
  }
  return sendTransfer(await prisma.withdrawal.findUnique({ where: { id: withdrawalId } }));
}

// TASK-024: refuse to start a transfer Paystack can't cover. It would fail
// anyway, and checking first keeps the withdrawal PENDING (wallet still
// debited, nothing in flight) instead of a failed transfer to clean up.
async function assertFloatCovers(withdrawal) {
  let balanceKobo;
  try {
    balanceKobo = await paystack.getNgnBalanceKobo();
  } catch (err) {
    throw new AppError('Could not check the payout balance at Paystack — try again shortly', 502);
  }
  if (balanceKobo < toKobo(withdrawal.amount)) {
    errorTracking.captureMessage('Payout float too low to pay a withdrawal', {
      withdrawalId: withdrawal.id,
      balanceNgn: balanceKobo / 100,
      amountNgn: Number(withdrawal.amount),
    });
    throw new AppError('The payout balance is too low for this withdrawal — top up Paystack and retry', 503);
  }
}

async function sendTransfer(withdrawal) {
  const destination = withdrawal.destination || {};
  let stage = 'recipient';
  let transfer;
  try {
    const recipient = await paystack.createTransferRecipient({
      name: destination.accountName,
      accountNumber: destination.accountNumber,
      bankCode: destination.bankCode,
    });
    stage = 'transfer';
    transfer = await paystack.initiateTransfer({
      amountKobo: toKobo(withdrawal.amount),
      recipientCode: recipient.recipient_code,
      reference: withdrawal.transferReference,
      reason: 'StreetBoardman withdrawal',
    });
  } catch (err) {
    if (!(err instanceof paystack.PaystackError)) throw err;
    return handleTransferError(withdrawal, err, stage);
  }

  await prisma.withdrawal.update({ where: { id: withdrawal.id }, data: { transferCode: transfer.transfer_code } });
  return applyProviderStatus(withdrawal.id, transfer.status, transfer.transfer_code);
}

// Failing to create the recipient means no transfer exists, whatever the
// error. A rejected transfer call might still be a duplicate of one that
// went through, so Paystack is asked by reference before the withdrawal
// goes back to PENDING. An unknown outcome stays PROCESSING for
// confirmStuckTransfers: guessing either way could pay twice or not at all.
async function handleTransferError(withdrawal, err, stage) {
  logger.warn(
    { event: 'payout_transfer_error', withdrawalId: withdrawal.id, stage, status: err.status },
    'Paystack transfer call failed'
  );

  if (stage === 'recipient') {
    await revertToPending(withdrawal.id, `Bank details rejected: ${err.message}`);
    throw new AppError('Paystack rejected the bank details — the withdrawal is back to pending', 502);
  }
  if (err.rejected) {
    const found = await findTransfer(withdrawal.transferReference);
    if (found === null) {
      await revertToPending(withdrawal.id, `Transfer rejected: ${err.message}`);
      throw new AppError('Paystack rejected the transfer — the withdrawal is back to pending', 502);
    }
    if (found) return applyProviderStatus(withdrawal.id, found.status, found.transfer_code);
  }
  errorTracking.captureMessage('Payout transfer outcome unknown', { withdrawalId: withdrawal.id }, 'warning');
  throw new AppError('Transfer sent but not yet confirmed — it will settle automatically', 502);
}

// null: Paystack has no such transfer. undefined: couldn't tell.
async function findTransfer(reference) {
  try {
    return await paystack.verifyTransfer(reference);
  } catch (err) {
    if (err instanceof paystack.PaystackError && err.status === 404) return null;
    return undefined;
  }
}

async function applyProviderStatus(withdrawalId, status, transferCode) {
  if (status === 'success') return settleTransferSucceeded(withdrawalId, { transferCode });
  if (status === 'failed' || status === 'reversed') {
    return settleTransferFailed(withdrawalId, `Paystack reported the transfer ${status}`);
  }
  if (status === 'otp') {
    // Transfers that wait for an OTP never complete on their own.
    errorTracking.captureMessage(
      'Paystack transfer is waiting for an OTP — disable OTP for transfers in the dashboard',
      { withdrawalId }
    );
  }
  return prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
}

async function revertToPending(withdrawalId, reason) {
  await prisma.withdrawal.updateMany({
    where: { id: withdrawalId, status: 'PROCESSING' },
    data: { status: 'PENDING', transferInitiatedAt: null, failureReason: reason.slice(0, 500) },
  });
}

// Settling is idempotent: webhooks are retried and the sweep may race
// them, so each settle is a conditional update that only one caller wins.
async function settleTransferSucceeded(withdrawalId, { transferCode, actorUserId } = {}) {
  return prisma.$transaction(async (tx) => {
    const claim = await tx.withdrawal.updateMany({
      where: { id: withdrawalId, status: 'PROCESSING' },
      data: { status: 'PROCESSED', processedAt: new Date(), ...(transferCode ? { transferCode } : {}) },
    });
    if (claim.count === 1) {
      await recordAuditLog(
        {
          actorUserId,
          action: 'WITHDRAWAL_PROCESSED',
          entityType: 'Withdrawal',
          entityId: withdrawalId,
          beforeState: { status: 'PROCESSING' },
          afterState: { status: 'PROCESSED' },
        },
        tx
      );
    }
    return tx.withdrawal.findUnique({ where: { id: withdrawalId } });
  });
}

// Failed, or reversed after success: the money is back at Paystack, so it
// goes back to the user's wallet, exactly once.
async function settleTransferFailed(withdrawalId, reason) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
    const claim = await tx.withdrawal.updateMany({
      where: { id: withdrawalId, status: { in: ['PROCESSING', 'PROCESSED'] } },
      data: { status: 'FAILED', processedAt: new Date(), failureReason: reason.slice(0, 500) },
    });
    if (claim.count === 1) {
      const wallet = await walletService.getWalletByUserId(tx, before.userId);
      await walletService.applyWalletTransaction(tx, {
        walletId: wallet.id,
        type: 'ADJUSTMENT',
        delta: before.amount,
        referenceType: 'Withdrawal',
        referenceId: withdrawalId,
        note: 'Withdrawal transfer failed — funds returned',
        counterparty: { type: 'EXTERNAL' },
      });
      await recordAuditLog(
        {
          action: 'WITHDRAWAL_TRANSFER_FAILED',
          entityType: 'Withdrawal',
          entityId: withdrawalId,
          beforeState: { status: before.status },
          afterState: { status: 'FAILED', reason },
        },
        tx
      );
      errorTracking.captureMessage(
        'Withdrawal transfer failed; funds returned to wallet',
        { withdrawalId, reason },
        'warning'
      );
    }
    return tx.withdrawal.findUnique({ where: { id: withdrawalId } });
  });
}

const TRANSFER_EVENTS = {
  'transfer.success': 'success',
  'transfer.failed': 'failed',
  'transfer.reversed': 'reversed',
};

// Called from the signed Paystack webhook. Unknown references are ignored
// (not ours); an amount that doesn't match what we sent is refused, the
// same rule deposits follow (TASK-004).
async function handlePaystackTransferEvent(eventType, data = {}) {
  const status = TRANSFER_EVENTS[eventType];
  if (!status) return null;
  const withdrawal = await prisma.withdrawal.findUnique({
    where: { transferReference: String(data.reference || '') },
  });
  if (!withdrawal) {
    logger.warn({ event: 'payout_webhook_unknown_reference', eventType }, 'Transfer webhook for an unknown reference');
    return null;
  }
  if (data.amount !== undefined && Number(data.amount) !== toKobo(withdrawal.amount)) {
    errorTracking.captureMessage('Transfer webhook amount does not match the withdrawal', {
      withdrawalId: withdrawal.id,
    });
    throw new AppError('Transfer amount mismatch', 400);
  }
  return applyProviderStatus(withdrawal.id, status, data.transfer_code);
}

const STUCK_AFTER_MS = 15 * 60 * 1000;

// Worker sweep: transfers still PROCESSING long after they were sent
// (webhook lost, or the API call's outcome was unknown) are asked about by
// reference. Not found means it never left: back to PENDING for an admin.
async function confirmStuckTransfers({ now = new Date(), limit = 20 } = {}) {
  if (env.appMode !== 'PRODUCTION' || !env.paystack.secretKey) return { checked: 0 };
  const stuck = await prisma.withdrawal.findMany({
    where: { status: 'PROCESSING', transferInitiatedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) } },
    orderBy: { transferInitiatedAt: 'asc' },
    take: limit,
  });
  for (const withdrawal of stuck) {
    const found = await findTransfer(withdrawal.transferReference);
    if (found === null) await revertToPending(withdrawal.id, 'Transfer was never created at Paystack');
    else if (found) await applyProviderStatus(withdrawal.id, found.status, found.transfer_code);
  }
  return { checked: stuck.length };
}

// TASK-024: is there enough at Paystack to pay everything users are
// waiting for, plus a safety margin? Alerts when not; also served to
// finance staff on the admin API.
async function checkPayoutFloat() {
  const owed = await prisma.withdrawal.aggregate({
    where: { status: { in: ['PENDING', 'PROCESSING'] } },
    _sum: { amount: true },
  });
  const owedNgn = Number(owed._sum.amount || 0);
  const thresholdNgn = env.payouts.floatAlertNgn;
  if (env.appMode !== 'PRODUCTION' || !env.paystack.secretKey) {
    return { live: false, owedNgn, balanceNgn: null, thresholdNgn, low: false };
  }
  const balanceNgn = (await paystack.getNgnBalanceKobo()) / 100;
  const low = balanceNgn < owedNgn + thresholdNgn;
  if (low) {
    logger.warn({ event: 'payout_float_low', balanceNgn, owedNgn }, 'Payout float is low');
    errorTracking.captureMessage('Payout float is low', { balanceNgn, owedNgn, thresholdNgn });
  }
  return { live: true, owedNgn, balanceNgn, thresholdNgn, low };
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
      // a rejected withdrawal never reached Paystack, so crediting it back
      // from the same counterparty keeps the ledger matching reality.
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

module.exports = {
  requestWithdrawal,
  listWithdrawalsForUser,
  processWithdrawal,
  rejectWithdrawal,
  handlePaystackTransferEvent,
  confirmStuckTransfers,
  checkPayoutFloat,
};
