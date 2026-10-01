const prisma = require('../config/db');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');
const errorTracking = require('../utils/errorTracking');
const settingsService = require('./settingsService');
const payoutService = require('./payoutService');
const { SETTING_KEYS } = require('../config/constants');
const { recordAuditLog } = require('../middleware/auditLog');

async function submitResult(boardmanProfile, competitionId, { winningOptionId, finalScore, evidenceUrls, notes }) {
  const competition = await prisma.competition.findUnique({
    where: { id: competitionId },
    include: { betOptions: true, result: true },
  });
  if (!competition) throw new AppError('Competition not found', 404);
  if (competition.boardmanProfileId !== boardmanProfile.id) {
    throw new AppError('You can only submit results for your own competitions', 403);
  }
  if (competition.status !== 'BETTING_CLOSED') {
    throw new AppError('Close betting before submitting a result', 400);
  }
  if (!competition.betOptions.some((o) => o.id === winningOptionId)) {
    throw new AppError('That betting option does not belong to this competition', 422);
  }

  const windowHours = await settingsService.getSetting(SETTING_KEYS.RESULT_CONFIRMATION_WINDOW_HOURS);
  const confirmationDeadline = new Date(Date.now() + windowHours * 60 * 60 * 1000);

  return prisma.$transaction(async (tx) => {
    const result = await tx.result.create({
      data: {
        competitionId,
        submittedByUserId: boardmanProfile.userId,
        winningOptionId,
        finalScore,
        evidenceUrls: evidenceUrls || [],
        notes,
        status: 'PENDING_CONFIRMATION',
        confirmationDeadline,
      },
    });
    await tx.competition.update({ where: { id: competitionId }, data: { status: 'PENDING_CONFIRMATION' } });
    return result;
  });
}

async function raiseDispute(userId, competitionId, reason) {
  const competition = await prisma.competition.findUnique({
    where: { id: competitionId },
    include: { result: true, boardmanProfile: true },
  });
  if (!competition || !competition.result) throw new AppError('No result to dispute yet', 404);
  if (competition.result.status !== 'PENDING_CONFIRMATION') {
    throw new AppError('This result can no longer be disputed', 400);
  }

  // Only someone with money on the outcome, or the Boardman who ran it, can
  // freeze payouts by disputing — otherwise any logged-in account could
  // grief an unrelated competition (TASK-011).
  const isBoardman = competition.boardmanProfile.userId === userId;
  if (!isBoardman) {
    const hasBet = await prisma.bet.findFirst({
      where: { competitionId, betterId: userId },
      select: { id: true },
    });
    if (!hasBet) {
      throw new AppError('Only a bettor on this competition or its Boardman can raise a dispute', 403);
    }
  }

  return prisma.$transaction(async (tx) => {
    const dispute = await tx.dispute.create({
      data: { competitionId, raisedByUserId: userId, reason, status: 'OPEN' },
    });
    await tx.result.update({ where: { competitionId }, data: { status: 'DISPUTED' } });
    await tx.competition.update({ where: { id: competitionId }, data: { status: 'DISPUTED' } });
    return dispute;
  });
}

// Admin-only. Either confirms the disputed result (payout proceeds, possibly
// with the winning option Admin decides on) or cancels the competition
// entirely with a full refund.
async function resolveDispute(adminUserId, disputeId, { action, winningOptionId }) {
  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!dispute) throw new AppError('Dispute not found', 404);
  if (dispute.status !== 'OPEN' && dispute.status !== 'UNDER_REVIEW') {
    throw new AppError('Dispute already resolved', 400);
  }

  if (action === 'CANCEL') {
    await prisma.$transaction(async (tx) => {
      await tx.dispute.update({
        where: { id: disputeId },
        data: { status: 'RESOLVED_CANCELLED', resolvedByAdminId: adminUserId, resolvedAt: new Date() },
      });
      await tx.result.update({
        where: { competitionId: dispute.competitionId },
        data: { status: 'CANCELLED' },
      });
      await recordAuditLog(
        {
          actorUserId: adminUserId,
          action: 'DISPUTE_RESOLVED_CANCELLED',
          entityType: 'Dispute',
          entityId: disputeId,
          beforeState: { status: dispute.status },
          afterState: { status: 'RESOLVED_CANCELLED' },
        },
        tx
      );
    });
    return payoutService.cancelAndRefundCompetition(dispute.competitionId);
  }

  if (action === 'CONFIRM') {
    await prisma.$transaction(async (tx) => {
      const result = await tx.result.findUnique({ where: { competitionId: dispute.competitionId } });
      await tx.result.update({
        where: { competitionId: dispute.competitionId },
        data: {
          status: 'CONFIRMED',
          winningOptionId: winningOptionId || result.winningOptionId,
          confirmedByAdminId: adminUserId,
          confirmedAt: new Date(),
        },
      });
      await tx.competition.update({ where: { id: dispute.competitionId }, data: { status: 'RESULT_CONFIRMED' } });
      await tx.dispute.update({
        where: { id: disputeId },
        data: { status: 'RESOLVED_CONFIRMED', resolvedByAdminId: adminUserId, resolvedAt: new Date() },
      });
      await recordAuditLog(
        {
          actorUserId: adminUserId,
          action: 'DISPUTE_RESOLVED_CONFIRMED',
          entityType: 'Dispute',
          entityId: disputeId,
          beforeState: { status: dispute.status, winningOptionId: result.winningOptionId },
          afterState: { status: 'RESOLVED_CONFIRMED', winningOptionId: winningOptionId || result.winningOptionId },
        },
        tx
      );
    });
    return payoutService.processPayoutsForCompetition(dispute.competitionId);
  }

  throw new AppError('Unknown dispute resolution action', 422);
}

// Scheduled sweep: any PENDING_CONFIRMATION result whose window has passed
// with no dispute raised gets auto-confirmed and paid out. See docs on why
// this window exists — it lets a competition close fast for everyone
// without needing an Admin to click "confirm" on every single one.
//
// A payout failure for one competition no longer aborts the rest of the
// sweep tick (TASK-005) — each is wrapped so the loop keeps going, and a
// failure is recorded via recordPayoutFailure below so retryStuckPayouts
// picks it back up on the next tick.
async function autoConfirmDueResults() {
  const due = await prisma.result.findMany({
    where: { status: 'PENDING_CONFIRMATION', confirmationDeadline: { lte: new Date() } },
  });

  const outcomes = [];
  for (const result of due) {
    await prisma.$transaction(async (tx) => {
      await tx.result.update({
        where: { id: result.id },
        data: { status: 'CONFIRMED', confirmedAt: new Date() },
      });
      await tx.competition.update({
        where: { id: result.competitionId },
        data: { status: 'RESULT_CONFIRMED' },
      });
    });
    try {
      outcomes.push(await payoutService.processPayoutsForCompetition(result.competitionId));
    } catch (err) {
      await recordPayoutFailure(result.competitionId, err);
      outcomes.push({ skipped: true, reason: 'Payout failed, will retry', error: err.message });
    }
  }
  return outcomes;
}

const MAX_PAYOUT_ATTEMPTS = 3;
// A competition just claimed for payout (see payoutService.claimForPayout)
// gets at least this long before the sweep treats it as "stuck" rather
// than "still running" — one full cron tick of grace.
const STUCK_PAYOUT_GRACE_MS = 2 * 60 * 1000;

async function recordPayoutFailure(competitionId, err) {
  const updated = await prisma.competition.update({
    where: { id: competitionId },
    data: {
      payoutAttemptCount: { increment: 1 },
      lastPayoutError: String(err.message || err).slice(0, 500),
    },
  });
  if (updated.payoutAttemptCount >= MAX_PAYOUT_ATTEMPTS) {
    // Structured so a log-based alert (report §9, FEAT-030) can match on
    // this event once real alert routing exists — for now this is the
    // loud signal an operator watching logs is expected to notice.
    logger.error(
      {
        event: 'payout_retries_exhausted',
        competitionId,
        attempts: updated.payoutAttemptCount,
        lastError: updated.lastPayoutError,
      },
      'Payout retries exhausted — needs manual intervention'
    );
    // Winners are waiting on money here — this needs a human, not just a log line.
    errorTracking.captureMessage('Payout retries exhausted', {
      competitionId,
      attempts: updated.payoutAttemptCount,
      lastError: updated.lastPayoutError,
    });
  } else {
    logger.warn(
      {
        event: 'payout_attempt_failed',
        competitionId,
        attempt: updated.payoutAttemptCount,
        error: updated.lastPayoutError,
      },
      'Payout attempt failed, will retry'
    );
  }
}

// Scheduled sweep, part 2: retries any competition that's still sitting in
// RESULT_CONFIRMED (payout never even started, e.g. the process crashed
// before claiming it) or PAYOUT_PROCESSING (claimed but interrupted
// partway through — see payoutService's per-bet chunking) after a grace
// period, up to MAX_PAYOUT_ATTEMPTS. This is what actually closes the gap
// TASK-006 opened up: chunking made a payout resumable, this is what
// resumes it without a human having to notice and click anything.
async function retryStuckPayouts() {
  const cutoff = new Date(Date.now() - STUCK_PAYOUT_GRACE_MS);
  const stuck = await prisma.competition.findMany({
    where: {
      status: { in: ['RESULT_CONFIRMED', 'PAYOUT_PROCESSING'] },
      updatedAt: { lte: cutoff },
      payoutAttemptCount: { lt: MAX_PAYOUT_ATTEMPTS },
    },
  });

  const outcomes = [];
  for (const competition of stuck) {
    try {
      outcomes.push(await payoutService.processPayoutsForCompetition(competition.id));
    } catch (err) {
      await recordPayoutFailure(competition.id, err);
      outcomes.push({ skipped: true, reason: 'Retry failed', error: err.message });
    }
  }
  return outcomes;
}

module.exports = {
  submitResult,
  raiseDispute,
  resolveDispute,
  autoConfirmDueResults,
  retryStuckPayouts,
};
