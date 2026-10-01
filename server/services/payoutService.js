const prisma = require('../config/db');
const AppError = require('../utils/appError');
const walletService = require('./walletService');
const commissionService = require('./commissionService');
const { toDecimal } = require('../utils/money');

// Claims the competition for payout (RESULT_CONFIRMED -> PAYOUT_PROCESSING)
// and reads everything needed to compute payouts, in one short transaction.
//
// Also doubles as a resume path (TASK-006): if the competition is already
// PAYOUT_PROCESSING — e.g. a previous run crashed partway through the
// per-bet loop below — this proceeds without re-claiming, since claiming
// again would find 0 rows matched (the status is no longer RESULT_CONFIRMED)
// and wrongly report "already processed". Any other status (COMPLETED,
// still BETTING_OPEN, etc.) is genuinely not eligible and returns null.
async function claimForPayout(competitionId) {
  return prisma.$transaction(async (tx) => {
    const claim = await tx.competition.updateMany({
      where: { id: competitionId, status: 'RESULT_CONFIRMED' },
      data: { status: 'PAYOUT_PROCESSING' },
    });

    if (claim.count === 0) {
      const existing = await tx.competition.findUnique({ where: { id: competitionId } });
      if (!existing) throw new AppError('Competition not found', 404);
      if (existing.status !== 'PAYOUT_PROCESSING') {
        return null;
      }
      // else: already claimed by an earlier, interrupted run — resume it.
    }

    const competition = await tx.competition.findUnique({
      where: { id: competitionId },
      include: { result: true, betOptions: { include: { bets: true } } },
    });
    if (!competition.result) throw new AppError('Competition has no result to pay out on', 400);
    return competition;
  });
}

// Pays a single winning bet in its own short transaction, so a competition
// with hundreds of winners never needs one transaction large enough to hit
// Prisma's default timeout (TASK-006 — was previously all bets in one
// transaction alongside the competition claim).
//
// Idempotent by construction: a Payout row is only ever left behind once
// its whole transaction (create + wallet credit + status flips) commits,
// so finding one already means this bet was fully paid by an earlier
// attempt — nothing left to do. This is what makes retrying a partially
// completed payout run (TASK-005) safe to just call again.
async function payOneBet(bet, amount, competitionTitle, competitionId) {
  const idempotencyKey = `payout:${bet.id}`;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.payout.findUnique({ where: { idempotencyKey } });
    if (existing) return existing;

    const wallet = await walletService.getWalletByUserId(tx, bet.betterId);
    const payout = await tx.payout.create({
      data: { betId: bet.id, amount, status: 'PENDING', idempotencyKey },
    });
    await walletService.applyWalletTransaction(tx, {
      walletId: wallet.id,
      type: 'BET_WIN',
      delta: amount,
      referenceType: 'Payout',
      referenceId: payout.id,
      note: `Winnings — ${competitionTitle}`,
      counterparty: { type: 'ESCROW', competitionId },
    });
    const processed = await tx.payout.update({
      where: { id: payout.id },
      data: { status: 'PROCESSED', processedAt: new Date() },
    });
    await tx.bet.update({ where: { id: bet.id }, data: { status: 'WON' } });
    return processed;
  });
}

// Marks losers, pays commission, and closes the competition out — also its
// own short transaction, run once all per-bet payouts above have settled.
// Idempotent via the unique constraint on Commission.competitionId: if a
// previous attempt already got this far, we just make sure the status
// reads COMPLETED and stop, instead of crediting commission twice.
async function finalizePayout(competitionId, competition, commission, losingBetIds) {
  return prisma.$transaction(async (tx) => {
    const existingCommission = await tx.commission.findUnique({ where: { competitionId } });
    if (existingCommission) {
      await tx.competition.updateMany({
        where: { id: competitionId, status: { not: 'COMPLETED' } },
        data: { status: 'COMPLETED' },
      });
      return { skipped: true, reason: 'Already finalized', commission: existingCommission };
    }

    if (losingBetIds.length > 0) {
      await tx.bet.updateMany({
        where: { id: { in: losingBetIds }, status: 'OPEN' },
        data: { status: 'LOST' },
      });
    }

    const boardmanUserId = (
      await tx.boardmanProfile.findUnique({ where: { id: competition.boardmanProfileId } })
    ).userId;
    const boardmanWallet = await walletService.getWalletByUserId(tx, boardmanUserId);
    const platformWallet = await walletService.getPlatformWallet(tx);

    const commissionRow = await tx.commission.create({
      data: {
        competitionId,
        boardmanId: boardmanUserId,
        totalStakePool: commission.totalStakePool,
        boardmanAmount: commission.boardmanAmount,
        platformAmount: commission.platformAmount,
      },
    });

    await walletService.applyWalletTransaction(tx, {
      walletId: boardmanWallet.id,
      type: 'COMMISSION',
      delta: commission.boardmanAmount,
      referenceType: 'Commission',
      referenceId: commissionRow.id,
      note: `Boardman commission — ${competition.title}`,
      counterparty: { type: 'ESCROW', competitionId },
    });
    await walletService.applyWalletTransaction(tx, {
      walletId: platformWallet.id,
      type: 'COMMISSION',
      delta: commission.platformAmount,
      referenceType: 'Commission',
      referenceId: commissionRow.id,
      note: `Platform commission — ${competition.title}`,
      counterparty: { type: 'ESCROW', competitionId },
    });

    await tx.competition.update({ where: { id: competitionId }, data: { status: 'COMPLETED' } });

    return { skipped: false, commission: commissionRow };
  });
}

async function processPayoutsForCompetition(competitionId) {
  const competition = await claimForPayout(competitionId);
  if (!competition) {
    return { skipped: true, reason: 'Already processed or not ready for payout' };
  }
  const result = competition.result;

  const allBets = competition.betOptions.flatMap((o) => o.bets);
  const totalStakePool = allBets.reduce((sum, b) => sum.plus(toDecimal(b.stake)), toDecimal(0));

  const winningOption = competition.betOptions.find((o) => o.id === result.winningOptionId);
  // Not filtered by status: on a resumed run some of these may already be
  // WON from a prior partial attempt. payOneBet is idempotent, so including
  // them again is harmless, and the payout math (proportional to stake)
  // doesn't change based on status either way.
  const winningBets = winningOption.bets;
  const otherBets = allBets.filter((b) => b.betOptionId !== winningOption.id);

  // Two no-contest cases (TASK-007), both handled the same way — full
  // refund of every stake, no commission taken:
  //  1. Nobody bet on the winning option at all: there's no one to pay,
  //     and taking commission while every other bettor's stake simply
  //     vanishes would be indefensible.
  //  2. Everybody who bet, bet on the winning option (no opposing stakes):
  //     there was never any real risk for commission to have been earned
  //     against, and a pari-mutuel split would pay winners LESS than they
  //     staked purely because commission was deducted from their own money.
  const noWinningBets = winningBets.length === 0;
  const oneSidedPool = !noWinningBets && otherBets.length === 0;
  if (noWinningBets || oneSidedPool) {
    return cancelAndRefundCompetition(competitionId);
  }

  const commission = commissionService.calculateCommission(
    totalStakePool,
    competition.boardmanCommissionRate,
    competition.platformCommissionRate
  );

  const payouts = commissionService.calculateWinnerPayouts(
    winningBets,
    winningOption.totalStaked,
    commission.distributablePool
  );

  for (const { betId, amount } of payouts) {
    const bet = winningBets.find((b) => b.id === betId);
    await payOneBet(bet, amount, competition.title, competitionId);
  }

  // Winners' shares are rounded down to the kobo, so a few kobo can be left
  // unallocated — never over-allocated (TASK-045). The leftover is folded
  // into the platform's commission rather than silently dropped (TASK-007),
  // and is always >= 0.
  const paidTotal = payouts.reduce((sum, p) => sum.plus(p.amount), toDecimal(0));
  const remainder = commission.distributablePool.minus(paidTotal);
  const adjustedCommission = { ...commission, platformAmount: commission.platformAmount.plus(remainder) };

  const losingBetIds = otherBets.filter((b) => b.status === 'OPEN').map((b) => b.id);

  const finalized = await finalizePayout(competitionId, competition, adjustedCommission, losingBetIds);
  return { skipped: false, payoutsCount: payouts.length, commission: finalized.commission };
}

// Cancels a competition and refunds every stake with no commission taken.
// Used for Admin-resolved disputes that go the "cancel" route, or a
// Boardman cancelling before any real-world result exists.
//
// NOTE: this still runs every refund inside one transaction, same
// scalability limit TASK-006 fixed for the payout path above. Left as-is
// for now (not in TASK-006's scope) but worth the same chunking treatment
// if a competition can realistically gather hundreds of bets before being
// cancelled.
//
// Concurrency: two refunds racing (a worker retry overlapping the first
// run, or an admin cancel during the auto-confirm sweep) used to BOTH
// refund every bet — each read "not finalized" and the same OPEN bets
// before either committed. Found by the money-conservation property test
// (TASK-045). Now the competition is claimed with a conditional update
// first: Postgres row-locks it, so the second transaction waits, then
// matches zero rows and skips. Each bet is also flipped OPEN -> REFUNDED
// conditionally before any money moves, as a second guard.
async function cancelAndRefundCompetition(competitionId) {
  return prisma.$transaction(async (tx) => {
    const claim = await tx.competition.updateMany({
      where: { id: competitionId, status: { notIn: ['COMPLETED', 'CANCELLED_REFUNDED'] } },
      data: { status: 'CANCELLED_REFUNDED' },
    });
    if (claim.count === 0) {
      const exists = await tx.competition.findUnique({ where: { id: competitionId }, select: { id: true } });
      if (!exists) throw new AppError('Competition not found', 404);
      return { skipped: true, reason: 'Already finalized' };
    }

    const competition = await tx.competition.findUnique({
      where: { id: competitionId },
      include: { betOptions: { include: { bets: true } } },
    });

    const openBets = competition.betOptions.flatMap((o) => o.bets).filter((b) => b.status === 'OPEN');
    let refundedCount = 0;
    for (const bet of openBets) {
      const flipped = await tx.bet.updateMany({ where: { id: bet.id, status: 'OPEN' }, data: { status: 'REFUNDED' } });
      if (flipped.count === 0) continue;
      refundedCount += 1;
      const wallet = await walletService.getWalletByUserId(tx, bet.betterId);
      await walletService.applyWalletTransaction(tx, {
        walletId: wallet.id,
        type: 'REFUND',
        delta: bet.stake,
        referenceType: 'Bet',
        referenceId: bet.id,
        note: `Refund — ${competition.title} cancelled`,
        counterparty: { type: 'ESCROW', competitionId },
      });
    }

    return { skipped: false, refundedCount };
  });
}

module.exports = { processPayoutsForCompetition, cancelAndRefundCompetition };
