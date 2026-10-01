const request = require('supertest');
const app = require('../../server/app');
const { resetDatabase, prisma } = require('../helpers/reset');
const kycService = require('../../server/services/kycService');

let phoneCounter = 0;
async function setupBetter() {
  phoneCounter += 1;
  const phone = `0895${String(phoneCounter).padStart(7, '0')}`;
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register/better').send({ fullName: 'Kyc Better', phone, pin: '1234' });
  return { agent, userId: res.body.user.id };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('kycService.verifyBvnOrNin (TASK-026)', () => {
  it('upgrades the user to TIER_1 on a matching BVN', async () => {
    const { userId } = await setupBetter();
    const result = await kycService.verifyBvnOrNin(userId, { idType: 'BVN', value: '12345678901' });

    expect(result.matched).toBe(true);
    expect(result.kycTier).toBe('TIER_1');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user.kycTier).toBe('TIER_1');
  });

  it('does not upgrade the tier on a mismatch, and records the attempt', async () => {
    const { userId } = await setupBetter();
    const result = await kycService.verifyBvnOrNin(userId, { idType: 'NIN', value: '00000000000' });

    expect(result.matched).toBe(false);
    expect(result.kycTier).toBe('TIER_0');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user.kycTier).toBe('TIER_0');

    const record = await prisma.kycVerification.findFirst({ where: { userId } });
    expect(record.matched).toBe(false);
    expect(record.idType).toBe('NIN');
  });

  it('matches the identity but refuses to upgrade the tier when the provider shows under 18 (TASK-028)', async () => {
    const { userId } = await setupBetter();
    const result = await kycService.verifyBvnOrNin(userId, { idType: 'NIN', value: '22222222222' });

    expect(result.matched).toBe(true);
    expect(result.underage).toBe(true);
    expect(result.kycTier).toBe('TIER_0');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user.kycTier).toBe('TIER_0');

    const record = await prisma.kycVerification.findFirst({ where: { userId } });
    expect(record.matched).toBe(true);
    expect(record.underage).toBe(true);
    expect(record.dateOfBirth).not.toBeNull();
  });

  it('does not flag an adult match as underage', async () => {
    const { userId } = await setupBetter();
    const result = await kycService.verifyBvnOrNin(userId, { idType: 'BVN', value: '33344455566' });
    expect(result.underage).toBe(false);
    expect(result.kycTier).toBe('TIER_1');
  });

  it('never stores the raw BVN/NIN value', async () => {
    const { userId } = await setupBetter();
    await kycService.verifyBvnOrNin(userId, { idType: 'BVN', value: '98765432109' });

    const record = await prisma.kycVerification.findFirst({ where: { userId } });
    expect(record.valueHash).not.toBe('98765432109');
    expect(record.valueHash).toHaveLength(64); // sha256 hex digest
  });
});

describe('POST /api/users/me/kyc/verify', () => {
  it('works end to end and reflects the new tier on GET /api/users/me', async () => {
    const { agent } = await setupBetter();
    const res = await agent.post('/api/users/me/kyc/verify').send({ idType: 'BVN', value: '11122233344' });
    expect(res.status).toBe(201);
    expect(res.body.matched).toBe(true);

    const me = await agent.get('/api/users/me');
    expect(me.body.user.kycTier).toBe('TIER_1');
  });

  it('rejects a malformed BVN/NIN with 422', async () => {
    const { agent } = await setupBetter();
    const res = await agent.post('/api/users/me/kyc/verify').send({ idType: 'BVN', value: '123' });
    expect(res.status).toBe(422);
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/users/me/kyc/verify').send({ idType: 'BVN', value: '11122233344' });
    expect(res.status).toBe(401);
  });
});
