// Data-protection rights under the NDPA (FEAT-060): consent records, a
// copy of your data, account deletion, retention.
const request = require('supertest');
const app = require('../../server/app');
const env = require('../../server/config/env');
const { POLICY_VERSIONS } = require('../../server/config/constants');
const { resetDatabase, prisma } = require('../helpers/reset');
const { resetAuthLimiter, nextPhone, staffAgent, approvedBoardman, fundedBetter, openCompetition } = require('../helpers/fixtures');
const privacyService = require('../../server/services/privacyService');
const { verifyMoney } = require('../../scripts/verify-money');

const original = { requireConsent: env.privacy.requireConsent };

beforeEach(async () => {
  await resetDatabase();
  await resetAuthLimiter();
  env.privacy.requireConsent = false;
});

afterAll(async () => {
  env.privacy.requireConsent = original.requireConsent;
  await prisma.$disconnect();
});

async function register(extra = {}) {
  const agent = request.agent(app);
  const phone = nextPhone('0970');
  const res = await agent.post('/api/auth/register/better').send({ fullName: 'Ngozi Better', phone, pin: '1234', ...extra });
  return { agent, phone, userId: res.body.user.id };
}

describe('Consent (FEAT-060)', () => {
  it('is recorded at sign-up when the form says so, and reported on /users/me', async () => {
    const withConsent = await register({ acceptPolicies: true });
    const without = await register();

    expect((await withConsent.agent.get('/api/users/me')).body.consentRequired).toBe(false);
    expect((await without.agent.get('/api/users/me')).body.consentRequired).toBe(true);
    const records = await prisma.consentRecord.findMany({ where: { userId: withConsent.userId } });
    expect(records.map((r) => `${r.document}:${r.version}`).sort()).toEqual(
      Object.entries(POLICY_VERSIONS).map(([d, v]) => `${d}:${v}`).sort()
    );
  });

  it('accepts only the current versions, once, and audits it', async () => {
    const u = await register();
    expect((await u.agent.post('/api/users/me/consent').send({ TERMS: 'old', PRIVACY: 'old' })).status).toBe(409);
    const ok = await u.agent.post('/api/users/me/consent').send(POLICY_VERSIONS);
    expect(ok.status).toBe(200);
    expect(ok.body.required).toBe(false);
    await u.agent.post('/api/users/me/consent').send(POLICY_VERSIONS);
    expect(await prisma.consentRecord.count({ where: { userId: u.userId } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: 'POLICIES_ACCEPTED', actorUserId: u.userId } })).toBe(2);
  });

  it('gates betting and deposits only when REQUIRE_POLICY_CONSENT is on', async () => {
    const u = await register();
    expect((await u.agent.post('/api/deposits/demo').send({ amount: 1000 })).status).toBe(201);

    env.privacy.requireConsent = true;
    const blocked = await u.agent.post('/api/deposits/demo').send({ amount: 1000 });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('CONSENT_REQUIRED');

    await u.agent.post('/api/users/me/consent').send(POLICY_VERSIONS);
    expect((await u.agent.post('/api/deposits/demo').send({ amount: 1000 })).status).toBe(201);
  });
});

describe('Download my data (FEAT-060)', () => {
  it('contains the user\'s own records and nothing secret or belonging to others', async () => {
    const bm = await approvedBoardman();
    const competition = await openCompetition(bm, 'Ludo night');
    const me = await fundedBetter(5000);
    const other = await fundedBetter(5000);
    await me.agent.post('/api/bets').send({ betOptionId: competition.betOptions[0].id, stake: 1000 });
    const theirs = await other.agent.post('/api/bets').send({ betOptionId: competition.betOptions[1].id, stake: 2000 });
    await prisma.auditLog.create({ data: { actorUserId: me.userId, action: 'INSIDER_BETTING_SUSPECTED', entityType: 'Bet', entityId: 'x' } });

    const res = await me.agent.get('/api/users/me/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="streetboardman-my-data-/);
    expect(res.body.profile).toMatchObject({ fullName: 'Ada Better', role: 'BETTER' });
    expect(res.body.bets).toEqual([expect.objectContaining({ competition: 'Ludo night', option: 'Tunde wins', status: 'OPEN' })]);
    expect(res.body.wallet.transactions.map((t) => t.type)).toEqual(['DEPOSIT', 'BET_STAKE']);
    expect(res.body.deposits).toHaveLength(1);

    const text = JSON.stringify(res.body);
    expect(text).not.toContain(theirs.body.bet.betCode);
    expect(text).not.toMatch(/passwordHash|mfaSecret|valueHash|deviceFingerprint|INSIDER_BETTING_SUSPECTED/);
    expect(await prisma.auditLog.count({ where: { action: 'PERSONAL_DATA_EXPORTED', actorUserId: me.userId } })).toBe(1);
  });

  it('is limited to 3 downloads a day', async () => {
    const me = await fundedBetter(100);
    for (let i = 0; i < 3; i += 1) expect((await me.agent.get('/api/users/me/export')).status).toBe(200);
    expect((await me.agent.get('/api/users/me/export')).status).toBe(429);
  });
});

describe('Delete my account (FEAT-060)', () => {
  const del = (agent, body = { pin: '1234', confirm: 'DELETE' }) => agent.post('/api/users/me/delete').send(body);

  it('anonymises the account, ends sessions, frees the phone and keeps the books balanced', async () => {
    const bm = await approvedBoardman();
    const competition = await openCompetition(bm);
    const u = await register({ acceptPolicies: true });
    // Some history first: deposit, bet, refund (cancelled), so financial records exist.
    await u.agent.post('/api/deposits/demo').send({ amount: 1000 });
    await u.agent.post('/api/bets').send({ betOptionId: competition.betOptions[0].id, stake: 1000 });
    await bm.agent.post(`/api/competitions/${competition.id}/cancel`).send({ reason: 'Rain stopped play' });
    await prisma.$executeRaw`UPDATE "Wallet" SET balance = 0 WHERE "userId" = ${u.userId}`; // as if withdrawn
    await prisma.$executeRaw`DELETE FROM "WalletTransaction" WHERE "walletId" = (SELECT id FROM "Wallet" WHERE "userId" = ${u.userId})`;
    await prisma.ledgerEntry.deleteMany({ where: { account: { wallet: { userId: u.userId } } } });

    const res = await del(u.agent);
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'].join(';')).toMatch(/sb_access=;/);

    const row = await prisma.user.findUnique({ where: { id: u.userId } });
    expect(row).toMatchObject({ fullName: 'Deleted user', phone: `deleted-${u.userId}`, email: null, deviceFingerprint: null, status: 'SUSPENDED' });
    expect(row.deletedAt).not.toBeNull();
    expect(await prisma.bet.count({ where: { betterId: u.userId } })).toBe(1); // financial record kept
    expect(await prisma.notification.count({ where: { userId: u.userId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'ACCOUNT_DELETED', entityId: u.userId } })).toBe(1);

    expect((await u.agent.get('/api/users/me')).status).toBeGreaterThanOrEqual(401);
    expect((await request(app).post('/api/auth/login').send({ phone: u.phone, pin: '1234' })).status).toBe(401);
    expect((await request(app).post('/api/auth/register/better').send({ fullName: 'New Owner', phone: u.phone, pin: '9999' })).status).toBe(201);
  });

  it('refuses while money or obligations remain, on a wrong PIN, without DELETE, and for staff', async () => {
    const bm = await approvedBoardman();
    const competition = await openCompetition(bm);
    const funded = await fundedBetter(1000);
    expect((await del(funded.agent)).status).toBe(409); // balance left

    await funded.agent.post('/api/bets').send({ betOptionId: competition.betOptions[0].id, stake: 1000 });
    const openBet = await del(funded.agent); // balance now 0, bet still open
    expect(openBet.status).toBe(409);
    expect(openBet.body.error).toMatch(/open bets/);

    expect((await del(bm.agent)).status).toBe(409); // Boardman with a live competition

    const fresh = await register();
    expect((await del(fresh.agent, { pin: '0000', confirm: 'DELETE' })).status).toBe(401);
    expect((await del(fresh.agent, { pin: '1234' })).status).toBe(422);

    const admin = await staffAgent('SUPER_ADMIN');
    expect((await del(admin.agent)).status).toBe(403);

    expect(await prisma.user.count({ where: { deletedAt: { not: null } } })).toBe(0);
  });

  it('leaves every money invariant intact after a deletion', async () => {
    const u = await register();
    await del(u.agent);
    const report = await verifyMoney(prisma);
    expect(report.failed).toEqual([]);
  });
});

describe('Retention (FEAT-060)', () => {
  it('deletes old login codes and old delivered notifications, nothing else', async () => {
    const u = await register();
    const now = new Date('2026-12-01T00:00:00Z');
    const daysAgo = (n) => new Date(now.getTime() - n * 24 * 3600 * 1000);
    await prisma.otpCode.createMany({
      data: [
        { phone: u.phone, purpose: 'SIGNUP', codeHash: 'x', expiresAt: daysAgo(10) },
        { phone: u.phone, purpose: 'SIGNUP', codeHash: 'y', expiresAt: daysAgo(1) },
      ],
    });
    await prisma.notification.createMany({
      data: [
        { userId: u.userId, type: 'T', message: 'old sent', status: 'SENT', dedupeKey: 'a', createdAt: daysAgo(200) },
        { userId: u.userId, type: 'T', message: 'old pending', status: 'PENDING', dedupeKey: 'b', createdAt: daysAgo(200) },
        { userId: u.userId, type: 'T', message: 'recent', status: 'SENT', dedupeKey: 'c', createdAt: daysAgo(5) },
      ],
    });

    expect(await privacyService.runRetention({ now })).toEqual({ otpCodesDeleted: 1, notificationsDeleted: 1 });
    expect((await prisma.notification.findMany({ orderBy: { message: 'asc' } })).map((n) => n.message)).toEqual(['old pending', 'recent']);
  });
});
