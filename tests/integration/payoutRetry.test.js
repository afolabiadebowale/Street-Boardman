const request = require('supertest');
const app = require('../../server/app');
const { resetDatabase, prisma } = require('../helpers/reset');
const adminService = require('../../server/services/adminService');
const resultService = require('../../server/services/resultService');
const logger = require('../../server/utils/logger');

async function setupApprovedBoardman(phone) {
  const admin = await prisma.user.create({
    data: { role: 'ADMIN', fullName: 'Admin', phone: `${phone}9`, passwordHash: 'x' },
  });
  await prisma.wallet.create({ data: { userId: admin.id, walletType: 'PLATFORM', balance: 0 } });

  const boardmanAgent = request.agent(app);
  const res = await boardmanAgent
    .post('/api/auth/register/boardman')
    .send({ fullName: 'Retry Boardman', phone, pin: '1234', businessLocation: 'Lagos' });
  const boardmanUserId = res.body.user.id;
  const profile = await prisma.boardmanProfile.findUnique({ where: { userId: boardmanUserId } });
  await adminService.approveBoardman(profile.id, admin.id);
  return { boardmanAgent, boardmanUserId, profileId: profile.id };
}

let phoneCounter = 0;
async function setupFundedBetter(amount = 20000) {
  phoneCounter += 1;
  const phone = `0809${String(phoneCounter).padStart(7, '0')}`;
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/register/better')
    .send({ fullName: 'Retry Better', phone, pin: '1234' });
  await agent.post('/api/deposits/demo').send({ amount });
  return { agent, userId: res.body.user.id };
}

async function createConfirmedCompetition(boardmanPhone) {
  const { boardmanAgent } = await setupApprovedBoardman(boardmanPhone);
  const { agent: better } = await setupFundedBetter(20000);
  const { agent: loser } = await setupFundedBetter(10000);

  const deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const createRes = await boardmanAgent.post('/api/competitions').send({
    title: 'Retry Test',
    category: 'FOOTBALL',
    bettingDeadline: deadline,
    options: ['Home', 'Away'],
  });
  const competitionId = createRes.body.competition.id;
  const homeOption = createRes.body.competition.betOptions.find((o) => o.label === 'Home');
  const awayOption = createRes.body.competition.betOptions.find((o) => o.label === 'Away');

  await better.post('/api/bets').send({ betOptionId: homeOption.id, stake: 5000 });
  // A losing-side bet, so this is a genuine two-sided pool (TASK-007
  // refunds a one-sided pool with no commission, which would bypass the
  // finalize-step failure this test relies on to exercise retries).
  await loser.post('/api/bets').send({ betOptionId: awayOption.id, stake: 2000 });
  await boardmanAgent.patch(`/api/competitions/${competitionId}/close-betting`);
  await boardmanAgent.post(`/api/competitions/${competitionId}/result`).send({ winningOptionId: homeOption.id });
  await prisma.result.update({ where: { competitionId }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });

  return competitionId;
}

async function backdateUpdatedAt(competitionId, minutesAgo) {
  const past = new Date(Date.now() - minutesAgo * 60 * 1000);
  await prisma.$executeRaw`UPDATE "Competition" SET "updatedAt" = ${past} WHERE id = ${competitionId}`;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('resultService.retryStuckPayouts (TASK-005)', () => {
  it('retries a competition left in RESULT_CONFIRMED past the grace period', async () => {
    const competitionId = await createConfirmedCompetition('08066000001');
    await prisma.competition.update({ where: { id: competitionId }, data: { status: 'RESULT_CONFIRMED' } });
    await backdateUpdatedAt(competitionId, 5);

    const outcomes = await resultService.retryStuckPayouts();
    expect(outcomes.some((o) => !o.skipped)).toBe(true);

    const final = await prisma.competition.findUnique({ where: { id: competitionId } });
    expect(final.status).toBe('COMPLETED');
  });

  it('leaves a recently claimed PAYOUT_PROCESSING competition alone (still within grace)', async () => {
    const competitionId = await createConfirmedCompetition('08066000002');
    await prisma.competition.update({ where: { id: competitionId }, data: { status: 'PAYOUT_PROCESSING' } });
    // No backdate — updatedAt is "now", well inside the grace window.

    await resultService.retryStuckPayouts();

    const stillStuck = await prisma.competition.findUnique({ where: { id: competitionId } });
    expect(stillStuck.status).toBe('PAYOUT_PROCESSING');
    expect(stillStuck.payoutAttemptCount).toBe(0);
  });

  it('caps retries at MAX_PAYOUT_ATTEMPTS and stops retrying after that, logging each failure', async () => {
    const competitionId = await createConfirmedCompetition('08066000003');
    await prisma.competition.update({ where: { id: competitionId }, data: { status: 'RESULT_CONFIRMED' } });

    // Force every payout attempt to fail deterministically: delete the
    // platform wallet, which getPlatformWallet requires during finalize.
    await prisma.wallet.deleteMany({ where: { walletType: 'PLATFORM' } });

    const errorSpy = jest.spyOn(logger, 'error');

    for (let i = 0; i < 5; i += 1) {
      await backdateUpdatedAt(competitionId, 5);
      // eslint-disable-next-line no-await-in-loop
      await resultService.retryStuckPayouts();
    }

    const final = await prisma.competition.findUnique({ where: { id: competitionId } });
    expect(final.payoutAttemptCount).toBe(3); // capped, not 5
    expect(final.lastPayoutError).toMatch(/Platform wallet/i);
    expect(final.status).toBe('PAYOUT_PROCESSING'); // never got to COMPLETED

    const exhaustedLog = errorSpy.mock.calls
      .map((args) => args[0])
      .find((obj) => obj && obj.event === 'payout_retries_exhausted');
    expect(exhaustedLog).toMatchObject({ competitionId, attempts: 3 });

    errorSpy.mockRestore();
  });
});
