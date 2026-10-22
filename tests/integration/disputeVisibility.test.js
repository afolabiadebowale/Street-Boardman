const request = require('supertest');
const app = require('../../server/app');
const { resetDatabase, prisma } = require('../helpers/reset');
const adminService = require('../../server/services/adminService');

// FEAT-040: before this, a Better who raised a dispute had no way to check
// on it after leaving the page — BetTicket.jsx's confirmation banner was
// local component state, gone on reload. GET /api/bets/:betCode now
// includes the competition's latest dispute, so the ticket can show its
// real, persistent status any time.
let userCounter = 0;
async function setupApprovedBoardman() {
  userCounter += 1;
  const admin = await prisma.user.create({
    data: { role: 'ADMIN', fullName: 'Admin', phone: `0820${String(userCounter).padStart(7, '0')}`, passwordHash: 'x' },
  });
  await prisma.wallet.create({ data: { userId: admin.id, walletType: 'PLATFORM', balance: 0 } });

  userCounter += 1;
  const boardmanAgent = request.agent(app);
  const res = await boardmanAgent.post('/api/auth/register/boardman').send({
    fullName: 'Visibility Boardman',
    phone: `0821${String(userCounter).padStart(7, '0')}`,
    pin: '1234',
    businessLocation: 'Lagos',
  });
  const boardmanUserId = res.body.user.id;
  const profile = await prisma.boardmanProfile.findUnique({ where: { userId: boardmanUserId } });
  await adminService.approveBoardman(profile.id, admin.id);
  return { boardmanAgent };
}

async function setupFundedBetter(amount = 20000) {
  userCounter += 1;
  const phone = `0822${String(userCounter).padStart(7, '0')}`;
  const agent = request.agent(app);
  await agent.post('/api/auth/register/better').send({ fullName: 'Visibility Better', phone, pin: '1234' });
  await agent.post('/api/deposits/demo').send({ amount });
  return { agent };
}

async function setupPendingConfirmationBet() {
  const { boardmanAgent } = await setupApprovedBoardman();
  const { agent: bettor } = await setupFundedBetter(10000);

  const deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const createRes = await boardmanAgent.post('/api/competitions').send({
    title: 'Dispute Visibility Test',
    category: 'FOOTBALL',
    bettingDeadline: deadline,
    options: ['Home', 'Away'],
  });
  const competitionId = createRes.body.competition.id;
  const home = createRes.body.competition.betOptions.find((o) => o.label === 'Home');

  const betRes = await bettor.post('/api/bets').send({ betOptionId: home.id, stake: 2000 });
  await boardmanAgent.patch(`/api/competitions/${competitionId}/close-betting`);
  await boardmanAgent.post(`/api/competitions/${competitionId}/result`).send({ winningOptionId: home.id });

  return { competitionId, betCode: betRes.body.bet.betCode, bettor };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /api/bets/:betCode — dispute visibility (FEAT-040)', () => {
  it('shows no dispute on the ticket before one is raised', async () => {
    const { betCode, bettor } = await setupPendingConfirmationBet();

    const res = await bettor.get(`/api/bets/${betCode}`);

    expect(res.status).toBe(200);
    expect(res.body.bet.betOption.competition.disputes).toEqual([]);
  });

  it("reflects the bettor's own dispute on their ticket once raised", async () => {
    const { competitionId, betCode, bettor } = await setupPendingConfirmationBet();

    await bettor.post(`/api/competitions/${competitionId}/dispute`).send({ reason: 'This result looks wrong' });
    const res = await bettor.get(`/api/bets/${betCode}`);

    expect(res.body.bet.betOption.competition.disputes).toHaveLength(1);
    expect(res.body.bet.betOption.competition.disputes[0].status).toBe('OPEN');
    expect(res.body.bet.betOption.competition.disputes[0].reason).toBe('This result looks wrong');
  });

  it("does not expose another better's ticket (ownership check still enforced)", async () => {
    const { betCode } = await setupPendingConfirmationBet();
    const { agent: stranger } = await setupFundedBetter(5000);

    const res = await stranger.get(`/api/bets/${betCode}`);

    expect(res.status).toBe(404);
  });
});
