const prisma = require('../config/db');
const AppError = require('../utils/appError');
const { toDecimal } = require('../utils/money');
const { recordAuditLog } = require('../middleware/auditLog');

// Responsible-gambling controls, set by the user for themselves: deposit
// and stake limits, self-exclusion and cooling-off. Gaming regulators
// expect them, and they protect the people most at risk.
//
// Limits are over rolling windows (the last 24 h / 7 days / 30 days), so
// there's no midnight reset to game. Lowering a limit applies at once;
// raising or removing it waits RAISE_DELAY_MS. Exclusion and cooling-off
// can only ever be extended: there is deliberately no way, for the user
// or for staff, to shorten one.
const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_MS = { DAY: DAY_MS, WEEK: 7 * DAY_MS, MONTH: 30 * DAY_MS };
const RAISE_DELAY_MS = DAY_MS;
const COOLING_OFF_MS = DAY_MS;
const EXCLUSION_MS = { '7d': 7 * DAY_MS, '30d': 30 * DAY_MS, '6m': 182 * DAY_MS };
const naira = (d) => `N${toDecimal(d).toNumber().toLocaleString('en-NG')}`;

// The limit in force right now: a queued raise/removal counts once due.
function effectiveAmount(limit, now = new Date()) {
  if (limit.pendingEffectiveAt && limit.pendingEffectiveAt <= now) return limit.pendingAmount;
  return limit.amount;
}

// ---- Checks used by betting and deposits -----------------------------------

// Uses the user row requireAuth already loaded: no extra query on the hot
// bet path.
function assertMayPlay(user, now = new Date()) {
  if (user.selfExcludedPermanent || (user.selfExcludedUntil && user.selfExcludedUntil > now)) {
    const until = user.selfExcludedPermanent ? 'permanently' : `until ${user.selfExcludedUntil.toISOString().slice(0, 10)}`;
    throw new AppError(`You have excluded yourself from betting ${until}. You can still withdraw your balance.`, 403, 'SELF_EXCLUDED');
  }
  if (user.coolingOffUntil && user.coolingOffUntil > now) {
    throw new AppError('You are taking a 24-hour break from betting. You can still withdraw your balance.', 403, 'COOLING_OFF');
  }
}

// Read outside the transaction, and only for users who have set a limit
// (user.hasGamblingLimits, already loaded by requireAuth): on a busy match
// every extra query on the bet path queues for a pool connection.
async function loadLimits(user, kind) {
  if (!user.hasGamblingLimits) return [];
  const userId = user.id;
  const now = new Date();
  const rows = await prisma.gamblingLimit.findMany({ where: { userId, kind } });
  return rows.map((r) => ({ period: r.period, amount: effectiveAmount(r, now) })).filter((r) => r.amount !== null);
}

async function usedInWindow(tx, userId, kind, since) {
  if (kind === 'STAKE') {
    const { _sum } = await tx.bet.aggregate({
      where: { betterId: userId, placedAt: { gte: since }, status: { notIn: ['VOID', 'REFUNDED'] } },
      _sum: { stake: true },
    });
    return toDecimal(_sum.stake || 0);
  }
  const { _sum } = await tx.deposit.aggregate({
    where: { userId, createdAt: { gte: since }, status: { in: ['SUCCESSFUL', 'PENDING'] } },
    _sum: { amount: true },
  });
  return toDecimal(_sum.amount || 0);
}

// Inside the bet/deposit transaction. Locking the user's own wallet row
// first serialises that user's concurrent bets or deposits, so two can't
// both fit under the limit separately and exceed it together. Other users
// never wait on it.
async function enforceLimits(tx, userId, kind, amount, limits) {
  if (!limits || limits.length === 0) return;
  await tx.$queryRaw`SELECT id FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE`;
  const now = Date.now();
  for (const { period, amount: limit } of limits) {
    const used = await usedInWindow(tx, userId, kind, new Date(now - PERIOD_MS[period]));
    if (used.plus(amount).gt(limit)) {
      const left = toDecimal(limit).minus(used);
      const what = kind === 'STAKE' ? 'stake' : 'deposit';
      throw new AppError(
        `This would go over your ${period.toLowerCase()}ly ${what} limit of ${naira(limit)} (${naira(left.gt(0) ? left : 0)} left)`,
        403,
        'LIMIT_EXCEEDED'
      );
    }
  }
}

// ---- Self-service controls -------------------------------------------------

async function getControls(user) {
  const now = new Date();
  const rows = await prisma.gamblingLimit.findMany({ where: { userId: user.id } });
  const limits = await Promise.all(
    rows.map(async (r) => ({
      kind: r.kind,
      period: r.period,
      amount: effectiveAmount(r, now),
      pending: r.pendingEffectiveAt && r.pendingEffectiveAt > now ? { amount: r.pendingAmount, effectiveAt: r.pendingEffectiveAt } : null,
      used: await usedInWindow(prisma, user.id, r.kind, new Date(now.getTime() - PERIOD_MS[r.period])),
    }))
  );
  return {
    limits,
    selfExclusion: user.selfExcludedPermanent
      ? { permanent: true }
      : user.selfExcludedUntil && user.selfExcludedUntil > now
        ? { until: user.selfExcludedUntil }
        : null,
    coolingOffUntil: user.coolingOffUntil && user.coolingOffUntil > now ? user.coolingOffUntil : null,
  };
}

// amount null = remove the limit (treated like a raise: queued).
async function setLimit(userId, { kind, period, amount }) {
  const now = new Date();
  const next = amount === null ? null : toDecimal(amount);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.gamblingLimit.findUnique({ where: { userId_kind_period: { userId, kind, period } } });
    const current = existing ? effectiveAmount(existing, now) : null;
    if (next === null && current === null) return { kind, period, amount: null, pending: null }; // nothing to remove
    const isTightening = next !== null && (current === null || next.lte(current));

    const data = isTightening
      ? { amount: next, pendingAmount: null, pendingEffectiveAt: null }
      : { amount: current, pendingAmount: next, pendingEffectiveAt: new Date(now.getTime() + RAISE_DELAY_MS) };
    await tx.user.update({ where: { id: userId }, data: { hasGamblingLimits: true } });
    const saved = await tx.gamblingLimit.upsert({
      where: { userId_kind_period: { userId, kind, period } },
      create: { userId, kind, period, ...data },
      update: data,
    });
    await recordAuditLog(
      {
        actorUserId: userId,
        action: 'GAMBLING_LIMIT_SET',
        entityType: 'GamblingLimit',
        entityId: saved.id,
        beforeState: { kind, period, amount: current === null ? null : String(current) },
        afterState: { requested: next === null ? null : String(next), appliesAt: isTightening ? 'now' : data.pendingEffectiveAt },
      },
      tx
    );
    return { kind, period, amount: saved.amount, pending: isTightening ? null : { amount: next, effectiveAt: data.pendingEffectiveAt } };
  });
}

// Extends only: the conditional update matches nothing if the new end is
// not later than the current one (or the exclusion is already permanent).
async function selfExclude(userId, period) {
  const permanent = period === 'permanent';
  const until = permanent ? null : new Date(Date.now() + EXCLUSION_MS[period]);
  const result = await prisma.user.updateMany({
    where: permanent
      ? { id: userId, selfExcludedPermanent: false }
      : { id: userId, selfExcludedPermanent: false, OR: [{ selfExcludedUntil: null }, { selfExcludedUntil: { lt: until } }] },
    data: permanent ? { selfExcludedPermanent: true } : { selfExcludedUntil: until },
  });
  if (result.count === 0) throw new AppError('You are already excluded for at least that long; an exclusion can only be extended', 409);
  await recordAuditLog({
    actorUserId: userId,
    action: 'SELF_EXCLUDED',
    entityType: 'User',
    entityId: userId,
    afterState: permanent ? { permanent: true } : { until },
  });
  return permanent ? { permanent: true } : { until };
}

// Starts only when no break is running (re-requesting mid-break would
// otherwise nudge the end forward by milliseconds and report success).
async function coolOff(userId) {
  const now = new Date();
  const until = new Date(now.getTime() + COOLING_OFF_MS);
  const result = await prisma.user.updateMany({
    where: { id: userId, OR: [{ coolingOffUntil: null }, { coolingOffUntil: { lte: now } }] },
    data: { coolingOffUntil: until },
  });
  if (result.count === 0) throw new AppError('You are already taking a break', 409);
  await recordAuditLog({ actorUserId: userId, action: 'COOLING_OFF_STARTED', entityType: 'User', entityId: userId, afterState: { until } });
  return { until };
}

module.exports = {
  assertMayPlay,
  loadLimits,
  enforceLimits,
  getControls,
  setLimit,
  selfExclude,
  coolOff,
  effectiveAmount,
  RAISE_DELAY_MS,
  PERIOD_MS,
};
