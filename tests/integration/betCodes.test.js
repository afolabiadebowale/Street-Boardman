const { resetDatabase, prisma } = require('../helpers/reset');
const walletService = require('../../server/services/walletService');
const depositService = require('../../server/services/depositService');
const bettingService = require('../../server/services/bettingService');

// Bet codes used to be count(bets) + 1, so concurrent bets got the same
// code and failed with a 500. The k6 hot-competition load test (TASK-048)
// saw 44% of bets fail that way.

let betOptionId;
let bettorIds;

beforeEach(async () => {
  await resetDatabase();
  const admin = await prisma.user.create({ data: { role: 'ADMIN', fullName: 'A', phone: '09470000001', passwordHash: 'x' } });
  const bm = await prisma.user.create({ data: { role: 'BOARDMAN', fullName: 'B', phone: '09470000002', passwordHash: 'x' } });
  const profile = await prisma.boardmanProfile.create({
    data: { userId: bm.id, businessLocation: 'Lagos', approvalStatus: 'APPROVED', approvedByAdminId: admin.id, approvedAt: new Date() },
  });
  const competition = await prisma.competition.create({
    data: {
      boardmanProfileId: profile.id,
      title: 'Busy match',
      category: 'FOOTBALL',
      status: 'BETTING_OPEN',
      bettingDeadline: new Date(Date.now() + 86400000),
      boardmanCommissionRate: 0.05,
      platformCommissionRate: 0.03,
      betOptions: { create: [{ label: 'A' }, { label: 'B' }] },
    },
    include: { betOptions: true },
  });
  betOptionId = competition.betOptions[0].id;

  bettorIds = [];
  for (let i = 0; i < 5; i += 1) {
    const u = await prisma.user.create({ data: { role: 'BETTER', fullName: `Bettor ${i}`, phone: `0947100000${i}`, passwordHash: 'x' } });
    await walletService.createWalletForUser(prisma, u.id, 'BETTER', true);
    await depositService.createDemoDeposit(u.id, 10000);
    bettorIds.push(u.id);
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Bet codes under concurrency', () => {
  it('gives every simultaneous bet its own code — none fail', async () => {
    const attempts = Array.from({ length: 25 }, (_, i) =>
      bettingService.placeBet({ betterId: bettorIds[i % bettorIds.length], betOptionId, stake: 100 })
    );
    const results = await Promise.allSettled(attempts);

    const failures = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
    expect(failures).toEqual([]);
    const codes = results.map((r) => r.value.betCode);
    expect(new Set(codes).size).toBe(25);
    codes.forEach((c) => expect(c).toMatch(/^SB-\d{6,}$/));
  });

  // Invariant guard rather than a reproduction: wallet writes lock the
  // wallet row before touching its ledger account, so this was already
  // serialized. The escrow account (above) had no such lock and did race.
  it('creates a new wallet\'s ledger account once, even when its first deposits arrive together', async () => {
    const u = await prisma.user.create({ data: { role: 'BETTER', fullName: 'Fresh', phone: '09472000000', passwordHash: 'x' } });
    const wallet = await walletService.createWalletForUser(prisma, u.id, 'BETTER', true);

    const results = await Promise.allSettled(Array.from({ length: 10 }, () => depositService.createDemoDeposit(u.id, 100)));

    expect(results.filter((r) => r.status === 'rejected').map((r) => r.reason.message)).toEqual([]);
    expect(await prisma.ledgerAccount.count({ where: { walletId: wallet.id } })).toBe(1);
    expect((await prisma.wallet.findUnique({ where: { id: wallet.id } })).balance.toString()).toBe('1000');
  });

  it('estimates the payout as if the bet were already counted, and updates the option total', async () => {
    // Empty match, 5% + 3% commission: a lone ₦1,000 bet would get ₦920 back.
    const first = await bettingService.placeBet({ betterId: bettorIds[0], betOptionId, stake: 1000 });
    expect(first.potentialPayout.toString()).toBe('920');
    expect(first.betOption.totalStaked.toString()).toBe('1000');

    // Second ₦1,000 on the same side: pool 2,000 -> 1,840 shared 50/50.
    const second = await bettingService.placeBet({ betterId: bettorIds[1], betOptionId, stake: 1000 });
    expect(second.potentialPayout.toString()).toBe('920');
    expect(second.betOption.totalStaked.toString()).toBe('2000');
  });

  it('keeps the option total exact under concurrent bets', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) =>
      bettingService.placeBet({ betterId: bettorIds[i % bettorIds.length], betOptionId, stake: 100 })
    ));
    const option = await prisma.betOption.findUnique({ where: { id: betOptionId } });
    expect(option.totalStaked.toString()).toBe('2000');
  });

  it('never reissues a code after a bet is deleted', async () => {
    const first = await bettingService.placeBet({ betterId: bettorIds[0], betOptionId, stake: 100 });
    const second = await bettingService.placeBet({ betterId: bettorIds[1], betOptionId, stake: 100 });
    await prisma.walletTransaction.deleteMany({ where: { referenceId: first.id } });
    await prisma.ledgerEntry.deleteMany({});
    await prisma.bet.delete({ where: { id: first.id } });

    const third = await bettingService.placeBet({ betterId: bettorIds[2], betOptionId, stake: 100 });
    expect([first.betCode, second.betCode]).not.toContain(third.betCode);
  });
});
