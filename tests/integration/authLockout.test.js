const request = require('supertest');
const app = require('../../server/app');
const { resetDatabase, prisma } = require('../helpers/reset');
const password = require('../../server/utils/password');
const { MAX_FAILED_ATTEMPTS } = require('../../server/services/authService');

// Per-account brute-force protection (ASVS 2.2.1, found in the TASK-036
// review). The per-IP limiter can't stop guesses spread across many IPs;
// this can. Kept to its own file because the per-IP limiter (20 per file)
// would otherwise interfere with counting.
const PHONE = '09400000001';

async function createBetter() {
  return prisma.user.create({
    data: { role: 'BETTER', fullName: 'Lock Test', phone: PHONE, passwordHash: await password.hash('1234') },
  });
}

const login = (pin, phone = PHONE) => request(app).post('/api/auth/login').send({ phone, pin });

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Per-account login lockout (TASK-036)', () => {
  it('locks after repeated wrong PINs — and then refuses even the correct PIN', async () => {
    await createBetter();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      expect((await login('0000')).status).toBe(401);
    }

    const locked = await login('1234');
    expect(locked.status).toBe(429);
    expect(locked.body.error).toMatch(/Too many failed attempts\. Try again in 15 minutes/);
    expect(locked.headers['set-cookie']).toBeUndefined();
  });

  it('lets the owner back in once the lock expires, and resets the count', async () => {
    const user = await createBetter();
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() - 1000) },
    });

    expect((await login('1234')).status).toBe(200);
    const reloaded = await prisma.user.findUnique({ where: { id: user.id } });
    expect(reloaded.lockedUntil).toBeNull();
    expect(reloaded.failedLoginCount).toBe(0);
  });

  it('a successful login clears earlier failures, so typos do not accumulate across days', async () => {
    const user = await createBetter();
    await login('0000');
    await login('0000');
    expect((await login('1234')).status).toBe(200);

    expect((await prisma.user.findUnique({ where: { id: user.id } })).failedLoginCount).toBe(0);
  });

  it('counts concurrent wrong guesses correctly — a burst cannot slip past the limit', async () => {
    const user = await createBetter();
    await Promise.all(Array.from({ length: MAX_FAILED_ATTEMPTS }, () => login('0000')));

    const reloaded = await prisma.user.findUnique({ where: { id: user.id } });
    expect(reloaded.lockedUntil).not.toBeNull();
  });

  it('gives an unknown phone number the same answer as a wrong PIN', async () => {
    const res = await login('1234', '09499999999');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid phone number or PIN');
  });
});
