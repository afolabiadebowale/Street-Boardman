const request = require('supertest');
const app = require('../../server/app');
const { resetDatabase, prisma } = require('../helpers/reset');
const adminService = require('../../server/services/adminService');

let userCounter = 0;
// Distinct User-Agent per call (TASK-029) so these tests exercise the
// name-matching signal in isolation, not accidentally the shared-device
// signal too — both agents otherwise come from the same loopback IP with
// supertest's default UA, which would look like the same device.
async function setupApprovedBoardman(fullName, userAgent = 'insider-test-boardman-device') {
  userCounter += 1;
  const admin = await prisma.user.create({
    data: { role: 'ADMIN', fullName: 'Insider Admin', phone: `0830${String(userCounter).padStart(7, '0')}`, passwordHash: 'x' },
  });
  await prisma.wallet.create({ data: { userId: admin.id, walletType: 'PLATFORM', balance: 0 } });

  userCounter += 1;
  const boardmanAgent = request.agent(app);
  const res = await boardmanAgent
    .post('/api/auth/register/boardman')
    .set('User-Agent', userAgent)
    .send({
      fullName,
      phone: `0831${String(userCounter).padStart(7, '0')}`,
      pin: '1234',
      businessLocation: 'Lagos',
    });
  const boardmanUserId = res.body.user.id;
  const profile = await prisma.boardmanProfile.findUnique({ where: { userId: boardmanUserId } });
  await adminService.approveBoardman(profile.id, admin.id);
  return { boardmanAgent, competitionSetup: async () => {
    const deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const createRes = await boardmanAgent.post('/api/competitions').send({
      title: 'Insider Test',
      category: 'FOOTBALL',
      bettingDeadline: deadline,
      options: ['Home', 'Away'],
    });
    return createRes.body.competition;
  } };
}

async function setupFundedBetter(fullName, amount = 10000, userAgent = 'insider-test-better-device') {
  userCounter += 1;
  const phone = `0832${String(userCounter).padStart(7, '0')}`;
  const agent = request.agent(app);
  await agent.post('/api/auth/register/better').set('User-Agent', userAgent).send({ fullName, phone, pin: '1234' });
  await agent.post('/api/deposits/demo').send({ amount });
  return { agent };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Insider-betting heuristic flag (TASK-014)', () => {
  it('flags a bet for admin review when the bettor name matches the Boardman name', async () => {
    const { boardmanAgent, competitionSetup } = await setupApprovedBoardman('Chinedu Okafor');
    const competition = await competitionSetup();
    const home = competition.betOptions.find((o) => o.label === 'Home');

    // Same name, different (second) account — the scenario this heuristic targets.
    const { agent: suspiciousBetter } = await setupFundedBetter('  chinedu   okafor  ');
    const betRes = await suspiciousBetter.post('/api/bets').send({ betOptionId: home.id, stake: 1000 });
    expect(betRes.status).toBe(201);

    const flags = await prisma.auditLog.findMany({
      where: { action: 'INSIDER_BETTING_SUSPECTED', entityId: betRes.body.bet.id },
    });
    expect(flags).toHaveLength(1);

    // The bet itself is NOT blocked — this is flag-only per TASK-014's scope.
    const bet = await prisma.bet.findUnique({ where: { id: betRes.body.bet.id } });
    expect(bet.status).toBe('OPEN');
    expect(boardmanAgent).toBeDefined();
  });

  it('does not flag an unrelated bettor with a different name', async () => {
    const { competitionSetup } = await setupApprovedBoardman('Chinedu Okafor');
    const competition = await competitionSetup();
    const home = competition.betOptions.find((o) => o.label === 'Home');

    const { agent: normalBetter } = await setupFundedBetter('Amaka Nwosu');
    const betRes = await normalBetter.post('/api/bets').send({ betOptionId: home.id, stake: 1000 });

    const flags = await prisma.auditLog.findMany({
      where: { action: 'INSIDER_BETTING_SUSPECTED', entityId: betRes.body.bet.id },
    });
    expect(flags).toHaveLength(0);
  });
});
