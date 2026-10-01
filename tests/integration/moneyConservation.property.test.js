const fc = require('fast-check');
const { resetDatabase, prisma } = require('../helpers/reset');
const walletService = require('../../server/services/walletService');
const depositService = require('../../server/services/depositService');
const competitionService = require('../../server/services/competitionService');
const bettingService = require('../../server/services/bettingService');
const resultService = require('../../server/services/resultService');
const payoutService = require('../../server/services/payoutService');
const reconciliationService = require('../../server/services/reconciliationService');
const ledgerService = require('../../server/services/ledgerService');
const { toDecimal } = require('../../server/utils/money');

// End-to-end money properties through the real services and Postgres
// (TASK-045). Each run builds a fresh world, plays out a random
// competition — random options, bettors, kobo-precise stakes, commission
// rates, and outcome — then checks invariants that must hold no matter
// what: no naira created or destroyed, ledger agrees with every wallet,
// escrow ends empty, and settling twice (even concurrently) pays once.

const MAX_BETTORS = 6;
const EXTRA_FUNDS = toDecimal(1000);

const scenario = fc
  .record({
    optionCount: fc.integer({ min: 2, max: 4 }),
    bets: fc.array(
      fc.record({
        bettor: fc.integer({ min: 0, max: MAX_BETTORS - 1 }),
        option: fc.integer({ min: 0, max: 3 }),
        stakeKobo: fc.integer({ min: 100_00, max: 5_000_00 }),
      }),
      { minLength: 1, maxLength: 12 }
    ),
    winner: fc.integer({ min: 0, max: 3 }),
    boardmanBps: fc.integer({ min: 0, max: 4500 }),
    platformBps: fc.integer({ min: 0, max: 4500 }),
    outcome: fc.constantFrom('result', 'result', 'result', 'cancel'),
    concurrentSettle: fc.boolean(),
  })
  .map((s) => ({
    ...s,
    winner: s.winner % s.optionCount,
    bets: s.bets.map((b) => ({ ...b, option: b.option % s.optionCount, stake: toDecimal(b.stakeKobo).dividedBy(100) })),
  }));

function regressionCase({ outcome }) {
  return {
    optionCount: 2,
    bets: [{ bettor: 0, option: 0, stakeKobo: 10000, stake: toDecimal(100) }],
    winner: 0,
    boardmanBps: 0,
    platformBps: 0,
    outcome,
    concurrentSettle: true,
  };
}

let seq = 0;
async function makeUser(role, walletType) {
  seq += 1;
  const user = await prisma.user.create({
    data: { role, fullName: `Prop ${role} ${seq}`, phone: `093${String(seq).padStart(8, '0')}`, passwordHash: 'x' },
  });
  await walletService.createWalletForUser(prisma, user.id, walletType, true);
  return user;
}

async function totalOfAllWallets() {
  const wallets = await prisma.wallet.findMany();
  return wallets.reduce((sum, w) => sum.plus(w.balance), toDecimal(0));
}

async function balancesById() {
  const wallets = await prisma.wallet.findMany({ orderBy: { id: 'asc' } });
  return Object.fromEntries(wallets.map((w) => [w.id, w.balance.toString()]));
}

async function playOut(s) {
  await resetDatabase();
  const admin = await makeUser('ADMIN', 'PLATFORM');
  const boardmanUser = await makeUser('BOARDMAN', 'BOARDMAN');
  const profile = await prisma.boardmanProfile.create({
    data: {
      userId: boardmanUser.id,
      businessLocation: 'Lagos',
      approvalStatus: 'APPROVED',
      approvedByAdminId: admin.id,
      approvedAt: new Date(),
    },
  });

  // Each bettor deposits exactly what they'll stake plus a fixed buffer, so
  // "money in" is known precisely.
  const stakedBy = new Map();
  for (const b of s.bets) stakedBy.set(b.bettor, (stakedBy.get(b.bettor) || toDecimal(0)).plus(b.stake));
  const bettors = new Map();
  let totalDeposited = toDecimal(0);
  for (const [index, staked] of stakedBy) {
    const user = await makeUser('BETTER', 'BETTER');
    const deposit = staked.plus(EXTRA_FUNDS);
    await depositService.createDemoDeposit(user.id, deposit.toNumber());
    bettors.set(index, { user, deposit, staked });
    totalDeposited = totalDeposited.plus(deposit);
  }

  const competition = await competitionService.createCompetition(profile, {
    title: `Property match ${seq}`,
    category: 'FOOTBALL',
    bettingDeadline: new Date(Date.now() + 86_400_000).toISOString(),
    options: Array.from({ length: s.optionCount }, (_, i) => `Option ${i}`),
  });
  await prisma.competition.update({
    where: { id: competition.id },
    data: { boardmanCommissionRate: s.boardmanBps / 10000, platformCommissionRate: s.platformBps / 10000 },
  });

  const placed = [];
  for (const b of s.bets) {
    const bet = await bettingService.placeBet({
      betterId: bettors.get(b.bettor).user.id,
      betOptionId: competition.betOptions[b.option].id,
      stake: b.stake.toNumber(),
    });
    placed.push({ ...b, betId: bet.id });
  }

  await competitionService.closeBetting(profile.id, competition.id);

  const settle = async () => {
    if (s.outcome === 'cancel') return payoutService.cancelAndRefundCompetition(competition.id);
    return payoutService.processPayoutsForCompetition(competition.id);
  };

  if (s.outcome === 'result') {
    await resultService.submitResult(profile, competition.id, { winningOptionId: competition.betOptions[s.winner].id });
    await prisma.result.update({ where: { competitionId: competition.id }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
    await prisma.competition.update({ where: { id: competition.id }, data: { status: 'RESULT_CONFIRMED' } });
  }

  if (s.concurrentSettle) {
    // Two settlement runs racing (e.g. two worker replicas, or a retry
    // overlapping the original). One may lose the race and throw — what
    // matters is that money moves exactly once.
    await Promise.allSettled([settle(), settle()]);
  } else {
    await settle();
  }

  return { competition, bettors, placed, totalDeposited, boardmanUser };
}

describe('money conservation through the real payout engine — properties (TASK-045)', () => {
  jest.setTimeout(300_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('holds for every random competition, stake, rate, and outcome', async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const world = await playOut(s);
        const { competition, bettors, placed, totalDeposited, boardmanUser } = world;

        // 1. No naira created or destroyed.
        expect((await totalOfAllWallets()).equals(totalDeposited)).toBe(true);

        // 2. No wallet ever negative.
        const wallets = await prisma.wallet.findMany();
        expect(wallets.every((w) => toDecimal(w.balance).gte(0))).toBe(true);

        // 3. Double-entry ledger agrees with every wallet balance.
        const recon = await reconciliationService.reconcileAllWallets();
        expect(recon.mismatches).toEqual([]);

        // 4. The competition's escrow is empty once settled.
        const escrow = await ledgerService.getOrCreateEscrowAccountForCompetition(prisma, competition.id);
        expect((await ledgerService.getAccountBalance(prisma, escrow.id)).equals(0)).toBe(true);

        const winningStakes = placed.filter((b) => b.option === s.winner);
        const refunded = s.outcome === 'cancel' || winningStakes.length === 0 || winningStakes.length === placed.length;
        const commission = await prisma.commission.findUnique({ where: { competitionId: competition.id } });

        if (refunded) {
          // 5a. Cancelled, nobody backed the winner, or nobody opposed them:
          // everyone gets every kobo back and no commission is taken.
          expect(commission).toBeNull();
          for (const { user, deposit } of bettors.values()) {
            const w = await prisma.wallet.findUnique({ where: { userId: user.id } });
            expect(toDecimal(w.balance).equals(deposit)).toBe(true);
          }
        } else {
          // 5b. Real result: the pool splits exactly into winners +
          // boardman + platform, and losers lose exactly their stakes.
          const pool = placed.reduce((sum, b) => sum.plus(b.stake), toDecimal(0));
          const payouts = await prisma.payout.findMany({ where: { bet: { competitionId: competition.id } } });
          expect(payouts).toHaveLength(winningStakes.length);
          const paid = payouts.reduce((sum, p) => sum.plus(p.amount), toDecimal(0));
          expect(paid.plus(commission.boardmanAmount).plus(commission.platformAmount).equals(pool)).toBe(true);
          expect(toDecimal(commission.platformAmount).gte(0)).toBe(true);

          const boardmanWallet = await prisma.wallet.findUnique({ where: { userId: boardmanUser.id } });
          expect(toDecimal(boardmanWallet.balance).equals(commission.boardmanAmount)).toBe(true);

          for (const [index, { user, deposit, staked }] of bettors) {
            const w = await prisma.wallet.findUnique({ where: { userId: user.id } });
            const won = placed
              .filter((b) => b.bettor === index && b.option === s.winner)
              .map((b) => payouts.find((p) => p.betId === b.betId).amount)
              .reduce((sum, a) => sum.plus(a), toDecimal(0));
            expect(toDecimal(w.balance).equals(deposit.minus(staked).plus(won))).toBe(true);
          }
        }

        // 6. Settling again is a no-op.
        const before = await balancesById();
        if (s.outcome === 'cancel') {
          await payoutService.cancelAndRefundCompetition(competition.id).catch(() => {});
        } else {
          await payoutService.processPayoutsForCompetition(competition.id);
        }
        expect(await balancesById()).toEqual(before);
      }),
      {
        numRuns: Number(process.env.PROPERTY_RUNS || 30),
        // Always run first. The first is the case this test found: a
        // one-sided pool (refund path) settled twice concurrently paid the
        // refund twice, creating ₦100 from nothing. The second covers the
        // same race on an explicit cancel.
        examples: [
          [regressionCase({ outcome: 'result' })],
          [regressionCase({ outcome: 'cancel' })],
        ],
      }
    );
  });
});
