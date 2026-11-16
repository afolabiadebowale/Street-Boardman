const prisma = require('../config/db');
const AppError = require('../utils/appError');
const settingsService = require('./settingsService');
const { SETTING_KEYS } = require('../config/constants');
const payoutService = require('./payoutService');
const boardmanTrustService = require('./boardmanTrustService');
const { poolView } = require('./poolService');
const { withOptionTotals } = require('./optionTotals');
const { recordAuditLog } = require('../middleware/auditLog');

async function createCompetition(boardmanProfile, { title, description, category, bettingDeadline, participants, options }) {
  if (boardmanProfile.approvalStatus !== 'APPROVED') {
    throw new AppError('Your Boardman account is not approved yet', 403);
  }
  if (new Date(bettingDeadline) <= new Date()) {
    throw new AppError('Betting deadline must be in the future', 422);
  }
  if (!options || options.length < 2) {
    throw new AppError('A competition needs at least two betting options', 422);
  }

  const boardmanRate = boardmanProfile.commissionRateOverride
    ?? (await settingsService.getSetting(SETTING_KEYS.BOARDMAN_COMMISSION_RATE));
  const platformRate = await settingsService.getSetting(SETTING_KEYS.PLATFORM_COMMISSION_RATE);

  // Combined commission can never reach or exceed the whole pool — winners
  // would be paid less than they staked even when a genuine winning side
  // exists (TASK-007).
  if (boardmanRate + platformRate >= 1) {
    throw new AppError('Combined Boardman and platform commission rates must be below 100%', 422);
  }

  const created = await prisma.competition.create({
    data: {
      boardmanProfileId: boardmanProfile.id,
      title,
      description,
      category,
      bettingDeadline: new Date(bettingDeadline),
      boardmanCommissionRate: boardmanRate,
      platformCommissionRate: platformRate,
      status: 'BETTING_OPEN',
      participants: { create: (participants || []).map((name) => ({ name })) },
      betOptions: { create: options.map((label) => ({ label })) },
    },
    include: { participants: true, betOptions: true },
  });
  return withOptionTotals(created);
}

// Public browse (FEAT-043): search across title, description and
// participants, filter by category, the Boardman's location, or closing
// soon, and sort by deadline, pool size or newest. Open competitions are a
// bounded set, so matches are loaded once (capped) and sorted and paged in
// memory, which is what makes "biggest pool" sortable at all.
const OPEN_LIST_CAP = 500;

async function listOpenCompetitions(query = {}) {
  const { q, category, location, closingWithinHours, boardmanProfileId, sort = 'deadline', page = 1, pageSize = 50 } = query;
  const where = {
    status: 'BETTING_OPEN',
    bettingDeadline: {
      gt: new Date(),
      ...(closingWithinHours ? { lte: new Date(Date.now() + closingWithinHours * 3600000) } : {}),
    },
    ...(category ? { category } : {}),
    ...(boardmanProfileId ? { boardmanProfileId } : {}),
    ...(location ? { boardmanProfile: { businessLocation: { contains: location, mode: 'insensitive' } } } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
            { participants: { some: { name: { contains: q, mode: 'insensitive' } } } },
          ],
        }
      : {}),
  };
  const matches = await prisma.competition.findMany({
    where,
    include: {
      betOptions: true,
      participants: true,
      boardmanProfile: { include: { user: { select: { fullName: true } } } },
    },
    orderBy: sort === 'newest' ? { createdAt: 'desc' } : { bettingDeadline: 'asc' },
    take: OPEN_LIST_CAP,
  });
  await withOptionTotals(matches);

  const withPool = matches.map((c) => ({ competition: c, pool: poolView(c) }));
  if (sort === 'pool') withPool.sort((a, b) => Number(b.pool.totalPool) - Number(a.pool.totalPool));
  const pageItems = withPool.slice((page - 1) * pageSize, page * pageSize);
  const cards = await boardmanTrustService.publicCards(pageItems.map(({ competition }) => competition.boardmanProfile));

  return {
    competitions: pageItems.map(({ competition, pool }) => toPublicCompetition(competition, pool, cards)),
    page: { page, pageSize, total: withPool.length },
  };
}

// Public shape: no internal ids beyond what the client links with, and the
// Boardman as a card, never their account.
function toPublicCompetition(competition, pool, cards) {
  // Payout retry internals (error text, attempt count) stay staff-only.
  const { boardmanProfile, lastPayoutError, payoutAttemptCount, ...rest } = competition;
  return { ...rest, pool, boardman: cards.get(competition.boardmanProfileId) || null };
}

async function getPublicCompetition(id) {
  const competition = await prisma.competition.findUnique({
    where: { id },
    include: {
      betOptions: true,
      participants: true,
      result: true,
      boardmanProfile: { include: { user: { select: { fullName: true } } } },
    },
  });
  if (!competition) throw new AppError('Competition not found', 404);
  await withOptionTotals(competition);
  const [pool, cards] = await Promise.all([
    poolForCompetition(competition),
    boardmanTrustService.publicCards([competition.boardmanProfile]),
  ]);
  return toPublicCompetition(competition, pool, cards);
}

// Light enough to poll while a match is live (FEAT-036).
async function getLivePool(id) {
  const competition = await prisma.competition.findUnique({
    where: { id },
    select: { id: true, status: true, bettingDeadline: true, boardmanCommissionRate: true, platformCommissionRate: true, betOptions: true },
  });
  if (!competition) throw new AppError('Competition not found', 404);
  await withOptionTotals(competition);
  return { id, status: competition.status, bettingDeadline: competition.bettingDeadline, pool: await poolForCompetition(competition) };
}

async function poolForCompetition(competition) {
  const counts = await prisma.bet.groupBy({
    by: ['betOptionId'],
    where: { competitionId: competition.id, status: { not: 'VOID' } },
    _count: true,
  });
  return poolView(competition, Object.fromEntries(counts.map((c) => [c.betOptionId, c._count])));
}

async function getCompetitionById(id) {
  const competition = await prisma.competition.findUnique({
    where: { id },
    include: { betOptions: true, participants: true, result: true },
  });
  if (!competition) throw new AppError('Competition not found', 404);
  return withOptionTotals(competition);
}

// The moment betting closes, the pool is final — no more bets can land
// (placeBet itself re-checks status). This is the one point we can tell
// every Better the real number instead of the guess they were given when
// they placed their bet: writes each OPEN bet's potentialPayout to
// poolView's final, one-sided-aware math (the same math placeBet's own
// estimate already shares). May still end up moot if the competition is
// refunded at settlement (too few betters, no winning side, etc.) — same
// as a one-sided pool's locked number today never actually getting paid.
async function lockFinalPayouts(competitionId) {
  const competition = await prisma.competition.findUnique({
    where: { id: competitionId },
    include: { betOptions: true },
  });
  if (!competition) return;
  await withOptionTotals(competition);
  const { options } = poolView(competition);
  for (const option of options) {
    if (option.payoutPer100 == null) continue; // nobody staked this option
    await prisma.$executeRaw`
      UPDATE "Bet"
      SET "potentialPayout" = ROUND("stake" * ${option.payoutPer100}::numeric / 100, 2)
      WHERE "betOptionId" = ${option.id} AND "status" = 'OPEN'`;
  }
}

async function closeBetting(boardmanProfileId, competitionId) {
  const competition = await getCompetitionById(competitionId);
  if (competition.boardmanProfileId !== boardmanProfileId) {
    throw new AppError('You can only manage your own competitions', 403);
  }
  if (competition.status !== 'BETTING_OPEN') {
    throw new AppError('Betting is not open on this competition', 400);
  }
  const updated = await prisma.competition.update({
    where: { id: competitionId },
    data: { status: 'BETTING_CLOSED' },
  });
  await lockFinalPayouts(competitionId);
  return updated;
}

// Called by a scheduled sweep (see server/jobs) so betting also closes
// automatically once the deadline passes, even if the Boardman forgets.
// Conditional per-competition update (not one bulk UPDATE) so each one
// that's actually closed by this call gets its payouts locked — and so
// this never double-processes one a manual close-betting call raced
// ahead of.
async function autoCloseExpiredCompetitions() {
  const due = await prisma.competition.findMany({
    where: { status: 'BETTING_OPEN', bettingDeadline: { lte: new Date() } },
    select: { id: true },
  });
  let count = 0;
  for (const { id } of due) {
    const claim = await prisma.competition.updateMany({
      where: { id, status: 'BETTING_OPEN' },
      data: { status: 'BETTING_CLOSED' },
    });
    if (claim.count === 0) continue; // already closed by something else
    await lockFinalPayouts(id);
    count += 1;
  }
  return count;
}

// Boardman edits while betting is open (FEAT-039). The description and
// deadline can change at any time; the title only until the first bet, so
// nobody's stake ends up on a match they didn't bet on. Options and
// commission rates never change once created, for the same reason.
// FOR UPDATE waits for bets in flight (each holds a KEY SHARE lock on the
// row until it commits) and holds off new ones, so the bet count is final.
async function updateCompetition(boardmanProfileId, competitionId, changes, actorUserId) {
  const data = {};
  if (changes.title !== undefined) data.title = changes.title;
  if (changes.description !== undefined) data.description = changes.description;
  if (changes.bettingDeadline !== undefined) {
    const deadline = new Date(changes.bettingDeadline);
    if (Number.isNaN(deadline.getTime()) || deadline <= new Date()) {
      throw new AppError('The betting deadline must be in the future', 422);
    }
    data.bettingDeadline = deadline;
  }
  if (Object.keys(data).length === 0) throw new AppError('Nothing to change', 422);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Competition" WHERE id = ${competitionId} FOR UPDATE`;
    const before = await tx.competition.findUnique({ where: { id: competitionId } });
    if (!before) throw new AppError('Competition not found', 404);
    if (before.boardmanProfileId !== boardmanProfileId) {
      throw new AppError('You can only manage your own competitions', 403);
    }
    const claim = await tx.competition.updateMany({
      where: { id: competitionId, boardmanProfileId, status: 'BETTING_OPEN' },
      data,
    });
    if (claim.count === 0) throw new AppError('A competition can only be edited while betting is open', 400);
    if (data.title !== undefined && data.title !== before.title) {
      const bets = await tx.bet.count({ where: { competitionId } });
      if (bets > 0) throw new AppError('The title can no longer change: bets have been placed', 400);
    }

    const fields = Object.keys(data);
    await recordAuditLog(
      {
        actorUserId,
        action: 'COMPETITION_EDITED',
        entityType: 'Competition',
        entityId: competitionId,
        beforeState: Object.fromEntries(fields.map((f) => [f, before[f]])),
        afterState: data,
      },
      tx
    );
    return withOptionTotals(
      await tx.competition.findUnique({ where: { id: competitionId }, include: { betOptions: true } }),
      tx
    );
  });
}

// A Boardman can call a competition off until a result is submitted;
// every stake is refunded and no commission is taken (FEAT-039). After a
// result exists, the dispute process is the only way to cancel.
const BOARDMAN_CANCELLABLE = ['DRAFT', 'BETTING_OPEN', 'BETTING_CLOSED'];

async function cancelCompetition(boardmanProfileId, competitionId, reason, actorUserId) {
  const competition = await getCompetitionById(competitionId);
  if (competition.boardmanProfileId !== boardmanProfileId) {
    throw new AppError('You can only manage your own competitions', 403);
  }
  const outcome = await payoutService.cancelAndRefundCompetition(competitionId, { allowedFrom: BOARDMAN_CANCELLABLE });
  if (outcome.skipped) {
    throw new AppError('This competition can no longer be cancelled: a result has been submitted. Raise a dispute instead.', 400);
  }
  await recordAuditLog({
    actorUserId,
    action: 'COMPETITION_CANCELLED',
    entityType: 'Competition',
    entityId: competitionId,
    beforeState: { status: competition.status },
    afterState: { status: 'CANCELLED_REFUNDED', reason, refundedBets: outcome.refundedCount },
  });
  return { competition: await getCompetitionById(competitionId), refundedBets: outcome.refundedCount };
}

module.exports = {
  createCompetition,
  listOpenCompetitions,
  getCompetitionById,
  getPublicCompetition,
  getLivePool,
  closeBetting,
  autoCloseExpiredCompetitions,
  updateCompetition,
  cancelCompetition,
};
