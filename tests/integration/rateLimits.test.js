const request = require('supertest');
const { generate: totpGenerate } = require('@otplib/totp');
const app = require('../../server/app');
const { resetDatabase, prisma } = require('../helpers/reset');
const password = require('../../server/utils/password');
const { base32Plugin, cryptoPlugin } = require('../../server/utils/totpPlugins');

// Limits added after CodeQL flagged handlers that do authorization work
// with no rate limit (PR #167).
let counter = 0;
async function bettor() {
  counter += 1;
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register/better').send({ fullName: 'Limits', phone: `0949000000${counter}`, pin: '1234' });
  return { agent, userId: res.body.user.id };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Rate limits', () => {
  it('puts a per-IP ceiling on every API request', async () => {
    const res = await request(app).get('/api/competitions');
    expect(res.headers['ratelimit-limit']).toBe('300');
  });

  it('caps BVN/NIN verification at 5 attempts an hour per user (each is a paid lookup)', async () => {
    const { agent } = await bettor();
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      expect((await agent.post('/api/users/me/kyc/verify').send({ idType: 'BVN', value: 'bad' })).status).toBe(422);
    }
    const sixth = await agent.post('/api/users/me/kyc/verify').send({ idType: 'BVN', value: 'bad' });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error).toMatch(/verification attempts/);
  });

  it('counts the KYC limit per user, not per IP', async () => {
    const first = await bettor();
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await first.agent.post('/api/users/me/kyc/verify').send({ idType: 'BVN', value: 'bad' });
    }
    const second = await bettor(); // same IP, different account
    expect((await second.agent.post('/api/users/me/kyc/verify').send({ idType: 'BVN', value: 'bad' })).status).toBe(422);
  });

  it('caps withdrawal requests at 10 an hour per user', async () => {
    const { agent } = await bettor();
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      expect((await agent.post('/api/withdrawals').send({ amount: 100 })).status).toBe(422);
    }
    expect((await agent.post('/api/withdrawals').send({ amount: 100 })).status).toBe(429);
  });
});

describe('Disabling MFA', () => {
  it('counts wrong codes toward the account lockout, so a stolen session cannot grind through them', async () => {
    const phone = '09491000001';
    const user = await prisma.user.create({
      data: { role: 'ADMIN', staffRole: 'SUPER_ADMIN', fullName: 'Staff', phone, passwordHash: await password.hash('1234') },
    });
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ phone, pin: '1234' });
    // Through the endpoints, as an admin would: enabling MFA signs out other
    // sessions but re-issues this one.
    const { body } = await agent.post('/api/auth/mfa/setup');
    const code = await totpGenerate({ secret: body.secret, crypto: cryptoPlugin, base32: base32Plugin });
    expect((await agent.post('/api/auth/mfa/setup/confirm').send({ code })).status).toBe(200);

    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      expect((await agent.post('/api/auth/mfa/disable').send({ code: '000000' })).status).toBe(400);
    }
    const locked = await agent.post('/api/auth/mfa/disable').send({ code: '000000' });
    expect(locked.status).toBe(429);
    expect(locked.body.error).toMatch(/Too many failed attempts/);
    expect((await prisma.user.findUnique({ where: { id: user.id } })).mfaEnabledAt).not.toBeNull();
  });
});
