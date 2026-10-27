// Responsible gambling (A2): deposit/stake limits, self-exclusion and
// cooling-off, set by the user and enforced by the server.
const { resetDatabase, prisma } = require('../helpers/reset');
const { resetAuthLimiter, staffAgent, approvedBoardman, fundedBetter, openCompetition, balanceOf } = require('../helpers/fixtures');

beforeEach(async () => {
  await resetDatabase();
  await resetAuthLimiter();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function setup(funds = 10000) {
  const bm = await approvedBoardman();
  const competition = await openCompetition(bm);
  const b = await fundedBetter(funds);
  const bet = (stake) => b.agent.post('/api/bets').send({ betOptionId: competition.betOptions[0].id, stake });
  const limit = (kind, period, amount) => b.agent.put('/api/users/me/limits').send({ kind, period, amount });
  return { bm, competition, b, bet, limit };
}

describe('Stake and deposit limits', () => {
  it('refuses a stake that would go over the limit and says how much is left', async () => {
    const { bet, limit } = await setup();
    expect((await limit('STAKE', 'DAY', 1500)).status).toBe(200);
    expect((await bet(1000)).status).toBe(201);

    const over = await bet(600);
    expect(over.status).toBe(403);
    expect(over.body).toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect(over.body.error).toMatch(/N500 left/);
    expect((await bet(500)).status).toBe(201);
  });

  it('holds under concurrent bets: they cannot each fit and exceed it together', async () => {
    const { b, bet, limit } = await setup();
    await limit('STAKE', 'DAY', 1000);
    const results = await Promise.all(Array.from({ length: 5 }, () => bet(300)));

    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 403)).toHaveLength(2);
    const staked = await prisma.bet.aggregate({ where: { betterId: b.userId }, _sum: { stake: true } });
    expect(Number(staked._sum.stake)).toBe(900);
  });

  it('applies a lower limit at once but waits 24 hours to raise or remove one', async () => {
    const { b, bet, limit } = await setup();
    await limit('STAKE', 'DAY', 1000);
    const raise = await limit('STAKE', 'DAY', 5000);
    expect(raise.body.limit.pending).toMatchObject({ amount: '5000' });
    expect((await bet(2000)).status).toBe(403); // still 1000 for now

    const controls = (await b.agent.get('/api/users/me/gambling-controls')).body;
    expect(controls.limits).toEqual([expect.objectContaining({ kind: 'STAKE', period: 'DAY', amount: '1000', used: '0' })]);
    expect(controls.limits[0].pending.amount).toBe('5000');

    // A day later the raise applies by itself.
    await prisma.gamblingLimit.updateMany({ data: { pendingEffectiveAt: new Date(Date.now() - 1000) } });
    expect((await bet(2000)).status).toBe(201);

    // Removing is a raise too: queued.
    await limit('STAKE', 'DAY', null);
    expect((await bet(4000)).status).toBe(403); // 5000 still applies, 2000 used
    await prisma.gamblingLimit.updateMany({ data: { pendingEffectiveAt: new Date(Date.now() - 1000) } });
    expect((await bet(4000)).status).toBe(201);

    expect(await prisma.auditLog.count({ where: { action: 'GAMBLING_LIMIT_SET', actorUserId: b.userId } })).toBe(3);
  });

  it('limits deposits too', async () => {
    const { b, limit } = await setup(0);
    await limit('DEPOSIT', 'WEEK', 2000);
    expect((await b.agent.post('/api/deposits/demo').send({ amount: 1500 })).status).toBe(201);
    const over = await b.agent.post('/api/deposits/demo').send({ amount: 600 });
    expect(over.status).toBe(403);
    expect(over.body.code).toBe('LIMIT_EXCEEDED');
    expect(await balanceOf(b.userId)).toBe(1500);
  });
});

describe('Self-exclusion and cooling-off', () => {
  it('blocks betting and deposits but still lets the user log in and withdraw', async () => {
    const { b, bet } = await setup();
    expect((await b.agent.post('/api/users/me/self-exclusion').send({ period: '7d' })).status).toBe(422); // no confirm
    const excluded = await b.agent.post('/api/users/me/self-exclusion').send({ period: '7d', confirm: true });
    expect(excluded.status).toBe(200);

    const blocked = await bet(100);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('SELF_EXCLUDED');
    expect((await b.agent.post('/api/deposits/demo').send({ amount: 100 })).status).toBe(403);

    await prisma.user.update({ where: { id: b.userId }, data: { kycTier: 'TIER_1' } });
    const withdrawal = await b.agent.post('/api/withdrawals').send({
      amount: 1000, pin: '1234', destination: { bankName: 'GTBank', accountNumber: '0123456789', accountName: 'Ada' },
    });
    expect(withdrawal.status).toBe(201);
    expect((await b.agent.get('/api/users/me/gambling-controls')).body.selfExclusion.until).toBeTruthy();
  });

  it('can only be extended, never shortened, and permanent is final', async () => {
    const { b } = await setup();
    const exclude = (period) => b.agent.post('/api/users/me/self-exclusion').send({ period, confirm: true });
    expect((await exclude('30d')).status).toBe(200);
    expect((await exclude('7d')).status).toBe(409); // shorter
    expect((await exclude('6m')).status).toBe(200); // longer
    expect((await exclude('permanent')).status).toBe(200);
    expect((await exclude('6m')).status).toBe(409);
    expect(await prisma.auditLog.count({ where: { action: 'SELF_EXCLUDED', actorUserId: b.userId } })).toBe(3);
  });

  it('cooling-off pauses betting for 24 hours', async () => {
    const { b, bet } = await setup();
    expect((await b.agent.post('/api/users/me/cooling-off')).status).toBe(200);
    expect((await b.agent.post('/api/users/me/cooling-off')).status).toBe(409);
    const blocked = await bet(100);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('COOLING_OFF');

    await prisma.user.update({ where: { id: b.userId }, data: { coolingOffUntil: new Date(Date.now() - 1000) } });
    expect((await bet(100)).status).toBe(201);
  });
});

describe('Access', () => {
  it('is for Betters, and support staff can see an account is excluded', async () => {
    const { bm, b } = await setup();
    expect((await bm.agent.get('/api/users/me/gambling-controls')).status).toBe(403);
    await b.agent.post('/api/users/me/self-exclusion').send({ period: 'permanent', confirm: true });

    const support = await staffAgent('SUPPORT');
    const users = (await support.agent.get('/api/admin/users?role=BETTER')).body.users;
    expect(users.find((u) => u.id === b.userId)).toMatchObject({ selfExcludedPermanent: true });
  });
});
