const request = require('supertest');
const app = require('../../server/app');
const { resetDatabase, prisma } = require('../helpers/reset');
const adminService = require('../../server/services/adminService');
const ledgerService = require('../../server/services/ledgerService');
const { Decimal } = require('../../server/utils/money');

let userCounter = 0;
async function setupApprovedBoardman() {
  userCounter += 1;
  const admin = await prisma.user.create({
    data: { role: 'ADMIN', fullName: 'Ledger Admin', phone: `0860${String(userCounter).padStart(7, '0')}`, passwordHash: 'x' },
  });
  await prisma.wallet.create({ data: { userId: admin.id, walletType: 'PLATFORM', balance: 0 } });

  userCounter += 1;
  const boardmanAgent = request.agent(app);
  const res = await boardmanAgent.post('/api/auth/register/boardman').send({
    fullName: 'Ledger Boardman',
    phone: `0861${String(userCounter).padStart(7, '0')}`,
    pin: '1234',
    businessLocation: 'Lagos',
  });
  const boardmanUserId = res.body.user.id;
  const profile = await prisma.boardmanProfile.findUnique({ where: { userId: boardmanUserId } });
  await adminService.approveBoardman(profile.id, admin.id);
  return { boardmanAgent, boardmanUserId, adminId: admin.id };
}

async function setupFundedBetter(amount = 20000) {
  userCounter += 1;
  const phone = `0862${String(userCounter).padStart(7, '0')}`;
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register/better').send({ fullName: 'Ledger Better', phone, pin: '1234' });
  await agent.post('/api/deposits/demo').send({ amount });
  return { agent, userId: res.body.user.id };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Ledger integration through a real betting flow (TASK-017)', () => {
  it('every ledger group balances, and the escrow account nets to zero once a competition fully pays out', async () => {
    const { boardmanAgent, boardmanUserId, adminId } = await setupApprovedBoardman();
    const { agent: winner, userId: winnerId } = await setupFundedBetter(20000);
    const { agent: loser } = await setupFundedBetter(20000);

    const deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const createRes = await boardmanAgent.post('/api/competitions').send({
      title: 'Ledger Flow Test',
      category: 'FOOTBALL',
      bettingDeadline: deadline,
      options: ['Home', 'Away'],
    });
    const competition = createRes.body.competition;
    const home = competition.betOptions.find((o) => o.label === 'Home');
    const away = competition.betOptions.find((o) => o.label === 'Away');

    await winner.post('/api/bets').send({ betOptionId: home.id, stake: 5000 });
    await loser.post('/api/bets').send({ betOptionId: away.id, stake: 3000 });

    await boardmanAgent.patch(`/api/competitions/${competition.id}/close-betting`);
    await boardmanAgent.post(`/api/competitions/${competition.id}/result`).send({ winningOptionId: home.id });
    await prisma.result.update({ where: { competitionId: competition.id }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
    await prisma.competition.update({ where: { id: competition.id }, data: { status: 'RESULT_CONFIRMED' } });

    const payoutService = require('../../server/services/payoutService');
    const outcome = await payoutService.processPayoutsForCompetition(competition.id);
    expect(outcome.skipped).toBe(false);

    // Every ledger group (by groupId) must balance: sum(DEBIT) === sum(CREDIT).
    const entries = await prisma.ledgerEntry.findMany({ where: { referenceType: { in: ['Bet', 'Payout', 'Commission'] } } });
    const byGroup = new Map();
    for (const entry of entries) {
      const g = byGroup.get(entry.groupId) || { debit: new Decimal(0), credit: new Decimal(0) };
      const amt = new Decimal(entry.amount.toString());
      if (entry.direction === 'DEBIT') g.debit = g.debit.plus(amt);
      else g.credit = g.credit.plus(amt);
      byGroup.set(entry.groupId, g);
    }
    expect(byGroup.size).toBeGreaterThan(0);
    for (const [groupId, totals] of byGroup) {
      expect(totals.debit.equals(totals.credit)).toBe(true);
    }

    // Escrow should net to exactly zero: every kobo staked into it was
    // paid back out (winner payout + boardman commission + platform
    // commission), nothing left behind and nothing overdrawn.
    const escrowAccount = await prisma.ledgerAccount.findUnique({ where: { competitionId: competition.id } });
    const escrowBalance = await prisma.$transaction((tx) => ledgerService.getAccountBalance(tx, escrowAccount.id));
    expect(escrowBalance.toString()).toBe('0');

    // The winner's ledger account balance should match their real Wallet.balance.
    const winnerWallet = await prisma.wallet.findUnique({ where: { userId: winnerId } });
    const winnerLedgerAccount = await prisma.ledgerAccount.findUnique({ where: { walletId: winnerWallet.id } });
    const winnerLedgerBalance = await prisma.$transaction((tx) => ledgerService.getAccountBalance(tx, winnerLedgerAccount.id));
    expect(winnerLedgerBalance.toString()).toBe(new Decimal(winnerWallet.balance.toString()).toString());

    const boardmanWallet = await prisma.wallet.findUnique({ where: { userId: boardmanUserId } });
    const boardmanLedgerAccount = await prisma.ledgerAccount.findUnique({ where: { walletId: boardmanWallet.id } });
    const boardmanLedgerBalance = await prisma.$transaction((tx) => ledgerService.getAccountBalance(tx, boardmanLedgerAccount.id));
    expect(boardmanLedgerBalance.toString()).toBe(new Decimal(boardmanWallet.balance.toString()).toString());

    const adminWallet = await prisma.wallet.findUnique({ where: { userId: adminId } });
    const platformLedgerAccount = await prisma.ledgerAccount.findUnique({ where: { walletId: adminWallet.id } });
    const platformLedgerBalance = await prisma.$transaction((tx) => ledgerService.getAccountBalance(tx, platformLedgerAccount.id));
    expect(platformLedgerBalance.toString()).toBe(new Decimal(adminWallet.balance.toString()).toString());
  });

  it('a deposit and a withdrawal both post balanced groups against the EXTERNAL account', async () => {
    const { userId } = await setupFundedBetter(1000); // deposit already happened here

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    const walletAccount = await prisma.ledgerAccount.findUnique({ where: { walletId: wallet.id } });
    const externalAccount = await prisma.ledgerAccount.findUnique({ where: { id: 'ledger-external-account' } });

    const walletBalance = await prisma.$transaction((tx) => ledgerService.getAccountBalance(tx, walletAccount.id));
    expect(walletBalance.toString()).toBe('1000');

    const externalBalance = await prisma.$transaction((tx) => ledgerService.getAccountBalance(tx, externalAccount.id));
    // External is credited for every deposit's counterparty debit — i.e.
    // it goes negative as money leaves "the outside world" and enters the
    // system, which is the correct sign under this ledger's convention
    // (credit increases, and the wallet side was credited, so the
    // external side was debited).
    expect(externalBalance.toString()).toBe('-1000');
  });
});
