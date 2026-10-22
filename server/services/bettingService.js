const prisma = require('../config/db');
const AppError = require('../utils/appError');
const walletService = require('./walletService');
const { addStake, totalsFor, withOptionTotals } = require('./optionTotals');
const { generateBetCode } = require('../utils/idGenerator');
const { toDecimal, round2 } = require('../utils/money');
const { recordAuditLog } = require('../middleware/auditLog');

const MIN_STAKE = 100; // NGN — keeps demo bets meaningful, avoids 1-kobo noise

function normalizeName(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Heuristic-only, flag-not-block check for a Boardman betting on their own
// competition from a second account (TASK-014). Two weak signals, either
// one enough to flag: the bettor's registered name matches the Boardman's
// own name, or (TASK-029) they registered from the same device
// fingerprint. Neither is proof — shared wifi/a family device can trigger
// the second, a common name the first — but both are real, honest signals
// rather than pretending to detect something the app can't yet see. A
// match is logged for Admin review, never blocked automatically: see the
// open product decision in the implementation plan on whether/when to
// hard-block.
async function flagIfSelfBettingSuspected(tx, { betId, betterId, boardmanProfile }) {
  const [better, boardmanUser] = await Promise.all([
    tx.user.findUnique({ where: { id: betterId }, select: { fullName: true, deviceFingerprint: true } }),
    tx.user.findUnique({
      where: { id: boardmanProfile.userId },
      select: { fullName: true, deviceFingerprint: true },
    }),
  ]);

  const nameMatches = normalizeName(better.fullName) === normalizeName(boardmanUser.fullName);
  const deviceMatches =
    Boolean(better.deviceFingerprint) && better.deviceFingerprint === boardmanUser.deviceFingerprint;
  if (!nameMatches && !deviceMatches) return;

  const reasons = [];
  if (nameMatches) reasons.push('name matches the Boardman');
  if (deviceMatches) reasons.push('registered from the same device as the Boardman');

  await recordAuditLog(
    {
      actorUserId: betterId,
      action: 'INSIDER_BETTING_SUSPECTED',
      entityType: 'Bet',
      entityId: betId,
      beforeState: null,
      afterState: {
        reason: reasons.join('; '),
        betterId,
        boardmanUserId: boardmanProfile.userId,
      },
    },
    tx
  );
}

// With an idempotencyKey, a retried request (the response was lost, e.g.
// the API restarted mid-request: seen in the FEAT-054 failure drill)
// returns the bet that was already placed, marked `replayed`, instead of
// placing and charging a second one.
async function placeBet({ betterId, betOptionId, stake, idempotencyKey }) {
  const stakeDecimal = round2(toDecimal(stake));
  if (stakeDecimal.lte(0) || stakeDecimal.lt(MIN_STAKE)) {
    throw new AppError(`Minimum stake is ₦${MIN_STAKE}`, 422);
  }
  if (idempotencyKey) {
    const earlier = await findByIdempotencyKey(betterId, idempotencyKey, { betOptionId, stakeDecimal });
    if (earlier) return earlier;
  }

  const betOption = await prisma.betOption.findUnique({
    where: { id: betOptionId },
    include: { competition: { include: { boardmanProfile: true } } },
  });
  if (!betOption) throw new AppError('Betting option not found', 404);

  const competition = betOption.competition;
  if (competition.status !== 'BETTING_OPEN') {
    throw new AppError('Betting is closed for this competition', 400);
  }
  if (new Date(competition.bettingDeadline) <= new Date()) {
    throw new AppError('Betting deadline has passed', 400);
  }

  // Rough live estimate only: (this bet's share of its option) times the
  // whole pool, minus commission, as if this bet were already counted.
  // The real payout is only known once betting closes — the UI labels
  // this as an estimate. Read without locks, before the transaction, so
  // the transaction stays as short as possible (TASK-048).
  const options = await prisma.betOption.findMany({ where: { competitionId: competition.id } });
  await withOptionTotals({ betOptions: options });
  const poolAfter = options.reduce((sum, o) => sum.plus(toDecimal(o.totalStaked)), stakeDecimal);
  const optionAfter = toDecimal(options.find((o) => o.id === betOptionId).totalStaked).plus(stakeDecimal);
  const estimatedPayout = round2(
    poolAfter
      .times(1 - competition.boardmanCommissionRate - competition.platformCommissionRate)
      .times(stakeDecimal.dividedBy(optionAfter))
  );

  try {
    return await placeBetTransaction({ betterId, betOptionId, stakeDecimal, idempotencyKey, competition, betOption, estimatedPayout });
  } catch (err) {
    // Two requests with the same key raced: the unique constraint let one
    // through and aborted this one. Return the winner's bet.
    if (idempotencyKey && err.code === 'P2002') {
      const earlier = await findByIdempotencyKey(betterId, idempotencyKey, { betOptionId, stakeDecimal });
      if (earlier) return earlier;
    }
    throw err;
  }
}

async function findByIdempotencyKey(betterId, idempotencyKey, { betOptionId, stakeDecimal }) {
  const earlier = await prisma.bet.findUnique({
    where: { betterId_idempotencyKey: { betterId, idempotencyKey } },
    include: { betOption: true },
  });
  if (!earlier) return null;
  if (earlier.betOptionId !== betOptionId || !toDecimal(earlier.stake).equals(stakeDecimal)) {
    throw new AppError('This Idempotency-Key was already used for a different bet', 409);
  }
  await withOptionTotals({ betOptions: [earlier.betOption] });
  return { ...earlier, replayed: true };
}

async function placeBetTransaction({ betterId, betOptionId, stakeDecimal, idempotencyKey, competition, betOption, estimatedPayout }) {
  return prisma.$transaction(async (tx) => {
    const betCode = await generateBetCode(tx);
    const wallet = await walletService.getWalletByUserId(tx, betterId);

    const bet = await tx.bet.create({
      data: {
        betCode,
        betterId,
        competitionId: competition.id,
        betOptionId,
        stake: stakeDecimal,
        potentialPayout: estimatedPayout,
        status: 'OPEN',
        idempotencyKey: idempotencyKey || null,
      },
    });

    // The checks above ran before this transaction, so a cancel could land
    // in between and leave this bet in a cancelled competition's escrow,
    // never refunded. Inserting the bet took a KEY SHARE lock on the
    // competition row (its foreign key), held until commit; cancelling
    // takes FOR UPDATE, which conflicts with it. So either this bet got in
    // first and the cancel waits for it and refunds it, or the cancel
    // committed first and this re-read sees it. No extra lock on the hot
    // path: an explicit FOR SHARE here measurably slowed bets in the
    // hot-competition load test (TASK-048).
    const [current] = await tx.$queryRaw`SELECT status FROM "Competition" WHERE id = ${competition.id}`;
    if (current.status !== 'BETTING_OPEN') {
      throw new AppError('Betting is closed for this competition', 400);
    }

    await walletService.applyWalletTransaction(tx, {
      walletId: wallet.id,
      type: 'BET_STAKE',
      delta: stakeDecimal.negated(),
      referenceType: 'Bet',
      referenceId: bet.id,
      note: `Stake on "${betOption.label}" — ${competition.title}`,
      counterparty: { type: 'ESCROW', competitionId: competition.id },
    });

    await flagIfSelfBettingSuspected(tx, {
      betId: bet.id,
      betterId,
      boardmanProfile: competition.boardmanProfile,
    });

    // Last statement before commit, so the shard row is locked for as
    // little time as possible. Sharded: concurrent bets on the same option
    // mostly land on different rows (TASK-048).
    await addStake(tx, betOptionId, stakeDecimal);
    const totals = await totalsFor([betOptionId], tx);
    const { competition: _competition, ...option } = betOption;

    return { ...bet, betOption: { ...option, totalStaked: totals.get(betOptionId) } };
  });
}

async function listBetsForBetter(betterId) {
  return prisma.bet.findMany({
    where: { betterId },
    include: { betOption: { include: { competition: true } } },
    orderBy: { placedAt: 'desc' },
  });
}

async function getBetByCode(betCode, betterId) {
  const bet = await prisma.bet.findUnique({
    where: { betCode },
    // The latest dispute (if any) on this competition, so a Better who
    // raised one — or whose bet is affected by one someone else raised —
    // can see where it stands any time they revisit the ticket, not just
    // in the one-time confirmation shown right after submitting it
    // (FEAT-040).
    include: {
      betOption: {
        include: {
          competition: {
            include: { disputes: { orderBy: { createdAt: 'desc' }, take: 1 } },
          },
        },
      },
    },
  });
  if (!bet || bet.betterId !== betterId) throw new AppError('Bet ticket not found', 404);
  return bet;
}

module.exports = { placeBet, listBetsForBetter, getBetByCode, MIN_STAKE };
