const request = require('supertest');
const app = require('../../server/app');
const { resetDatabase, prisma } = require('../helpers/reset');
const adminService = require('../../server/services/adminService');

let counter = 0;
function nextPhone(prefix) {
  counter += 1;
  return `${prefix}${String(counter).padStart(7, '0')}`;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Device fingerprint dedup at registration (TASK-029)', () => {
  it('flags a second registration from the same device (same simulated User-Agent + IP)', async () => {
    const ua = 'device-fingerprint-test-1';
    const first = await request(app)
      .post('/api/auth/register/better')
      .set('User-Agent', ua)
      .send({ fullName: 'First Person', phone: nextPhone('0897'), pin: '1234' });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/auth/register/better')
      .set('User-Agent', ua)
      .send({ fullName: 'Second Person', phone: nextPhone('0897'), pin: '1234' });
    expect(second.status).toBe(201); // never blocked, only flagged

    const flags = await prisma.auditLog.findMany({
      where: { action: 'DEVICE_FINGERPRINT_REUSED', entityId: second.body.user.id },
    });
    expect(flags).toHaveLength(1);
    expect(flags[0].afterState.matchedExistingUserId).toBe(first.body.user.id);
  });

  it('does not flag registrations from different devices', async () => {
    const first = await request(app)
      .post('/api/auth/register/better')
      .set('User-Agent', 'device-a')
      .send({ fullName: 'Person A', phone: nextPhone('0898'), pin: '1234' });

    const second = await request(app)
      .post('/api/auth/register/better')
      .set('User-Agent', 'device-b')
      .send({ fullName: 'Person B', phone: nextPhone('0898'), pin: '1234' });

    const flags = await prisma.auditLog.findMany({
      where: { action: 'DEVICE_FINGERPRINT_REUSED', entityId: second.body.user.id },
    });
    expect(flags).toHaveLength(0);
  });

  it('stores a fingerprint hash, not raw IP/User-Agent', async () => {
    const res = await request(app)
      .post('/api/auth/register/better')
      .set('User-Agent', 'plaintext-check-agent')
      .send({ fullName: 'Hash Check', phone: nextPhone('0899'), pin: '1234' });

    const user = await prisma.user.findUnique({ where: { id: res.body.user.id } });
    expect(user.deviceFingerprint).not.toContain('plaintext-check-agent');
    expect(user.deviceFingerprint).toHaveLength(64); // sha256 hex digest
  });
});

describe('Insider-betting flag also fires on a shared device (TASK-029 extends TASK-014)', () => {
  it('flags a bet when the bettor and Boardman share a device fingerprint, even with different names', async () => {
    const sharedUa = 'shared-device-insider-test';

    const admin = await prisma.user.create({
      data: { role: 'ADMIN', fullName: 'Device Admin', phone: nextPhone('0900'), passwordHash: 'x' },
    });
    await prisma.wallet.create({ data: { userId: admin.id, walletType: 'PLATFORM', balance: 0 } });

    const boardmanRes = await request(app)
      .post('/api/auth/register/boardman')
      .set('User-Agent', sharedUa)
      .send({ fullName: 'Boardman Name', phone: nextPhone('0901'), pin: '1234', businessLocation: 'Lagos' });
    const profile = await prisma.boardmanProfile.findUnique({ where: { userId: boardmanRes.body.user.id } });
    await adminService.approveBoardman(profile.id, admin.id);
    const boardmanAgent = request.agent(app);
    await boardmanAgent
      .set('User-Agent', sharedUa)
      .post('/api/auth/login')
      .send({ phone: boardmanRes.body.user.phone, pin: '1234' });

    const betterAgent = request.agent(app);
    const betterRes = await betterAgent
      .set('User-Agent', sharedUa)
      .post('/api/auth/register/better')
      .send({ fullName: 'Totally Different Name', phone: nextPhone('0902'), pin: '1234' });
    await betterAgent.set('User-Agent', sharedUa).post('/api/deposits/demo').send({ amount: 5000 });

    const deadline = new Date(Date.now() + 3600000).toISOString();
    const compRes = await boardmanAgent
      .set('User-Agent', sharedUa)
      .post('/api/competitions')
      .send({ title: 'Device Match Test', category: 'FOOTBALL', bettingDeadline: deadline, options: ['A', 'B'] });
    const optionA = compRes.body.competition.betOptions[0];

    const betRes = await betterAgent
      .set('User-Agent', sharedUa)
      .post('/api/bets')
      .send({ betOptionId: optionA.id, stake: 1000 });
    expect(betRes.status).toBe(201);

    const flags = await prisma.auditLog.findMany({
      where: { action: 'INSIDER_BETTING_SUSPECTED', entityId: betRes.body.bet.id },
    });
    expect(flags).toHaveLength(1);
    expect(flags[0].afterState.reason).toMatch(/same device/);
    expect(betterRes.body.user.fullName).toBe('Totally Different Name'); // confirms name-match wasn't the trigger
  });
});
