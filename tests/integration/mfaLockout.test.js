const request = require('supertest');
const app = require('../../server/app');
const { resetDatabase, prisma } = require('../helpers/reset');
const password = require('../../server/utils/password');
const { generateSecret } = require('@otplib/core');
const { base32Plugin, cryptoPlugin } = require('../../server/utils/totpPlugins');
const { MAX_FAILED_ATTEMPTS } = require('../../server/services/authService');

// Someone holding a stolen PIN gets past step one; wrong MFA codes must
// burn the same lockout budget, or they could guess codes indefinitely
// (TASK-036).
const PHONE = '09440000001';

beforeEach(async () => {
  await resetDatabase();
  await prisma.user.create({
    data: {
      role: 'ADMIN',
      staffRole: 'SUPER_ADMIN',
      fullName: 'Staff',
      phone: PHONE,
      passwordHash: await password.hash('1234'),
      mfaSecret: generateSecret({ length: 20, crypto: cryptoPlugin, base32: base32Plugin }),
      mfaEnabledAt: new Date(),
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

it('wrong MFA codes lock the account just like wrong PINs', async () => {
  const { body } = await request(app).post('/api/auth/login').send({ phone: PHONE, pin: '1234' });
  expect(body.mfaRequired).toBe(true);

  for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app).post('/api/auth/mfa/verify').send({ mfaToken: body.mfaToken, code: '000000' });
    expect(res.status).toBe(400);
  }

  const lockedCode = await request(app).post('/api/auth/mfa/verify').send({ mfaToken: body.mfaToken, code: '000000' });
  expect(lockedCode.status).toBe(429);
  const lockedPin = await request(app).post('/api/auth/login').send({ phone: PHONE, pin: '1234' });
  expect(lockedPin.status).toBe(429);
});
