const request = require('supertest');
const app = require('../../server/app');
const { resetDatabase, prisma } = require('../helpers/reset');
const otpService = require('../../server/services/otpService');
const logger = require('../../server/utils/logger');

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// DEMO mode's smsProvider logs the code instead of sending it — tests
// capture it from that log event, rather than reading the hashed DB
// column (which is deliberately opaque).
async function requestAndCaptureCode(phone, purpose) {
  const logSpy = jest.spyOn(logger, 'info');
  await otpService.requestOtp(phone, purpose);
  const event = logSpy.mock.calls
    .map((args) => args[0])
    .find((obj) => obj && obj.event === 'demo_sms_otp' && obj.phone === phone);
  logSpy.mockRestore();
  return event.code;
}

describe('otpService (TASK-025)', () => {
  it('issues a code and verifies successfully with it', async () => {
    const code = await requestAndCaptureCode('08090000001', 'SIGNUP');
    const result = await otpService.verifyOtp('08090000001', 'SIGNUP', code);
    expect(result.verified).toBe(true);
  });

  it('marks phoneVerifiedAt on the matching user for a SIGNUP verification', async () => {
    await prisma.user.create({
      data: { role: 'BETTER', fullName: 'Otp Better', phone: '08090000002', passwordHash: 'x' },
    });
    const code = await requestAndCaptureCode('08090000002', 'SIGNUP');
    await otpService.verifyOtp('08090000002', 'SIGNUP', code);

    const user = await prisma.user.findUnique({ where: { phone: '08090000002' } });
    expect(user.phoneVerifiedAt).not.toBeNull();
  });

  it('rejects an incorrect code and increments attempts without consuming it', async () => {
    await requestAndCaptureCode('08090000003', 'SIGNUP');
    await expect(otpService.verifyOtp('08090000003', 'SIGNUP', '000000')).rejects.toMatchObject({ statusCode: 400 });

    const record = await prisma.otpCode.findFirst({ where: { phone: '08090000003' } });
    expect(record.attempts).toBe(1);
    expect(record.consumedAt).toBeNull();
  });

  it('locks out after MAX_ATTEMPTS wrong tries, even if the right code is finally given', async () => {
    const code = await requestAndCaptureCode('08090000004', 'SIGNUP');
    for (let i = 0; i < otpService.MAX_ATTEMPTS; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await expect(otpService.verifyOtp('08090000004', 'SIGNUP', '000000')).rejects.toMatchObject({ statusCode: 400 });
    }
    await expect(otpService.verifyOtp('08090000004', 'SIGNUP', code)).rejects.toMatchObject({ statusCode: 429 });
  });

  it('rejects a code after it has expired', async () => {
    const code = await requestAndCaptureCode('08090000005', 'SIGNUP');
    await prisma.otpCode.updateMany({
      where: { phone: '08090000005' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(otpService.verifyOtp('08090000005', 'SIGNUP', code)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses a second request too soon after the first (per-phone cooldown)', async () => {
    await requestAndCaptureCode('08090000006', 'SIGNUP');
    await expect(otpService.requestOtp('08090000006', 'SIGNUP')).rejects.toMatchObject({ statusCode: 429 });
  });

  it('keeps SIGNUP and BANK_ACCOUNT_CHANGE codes independent for the same phone', async () => {
    const signupCode = await requestAndCaptureCode('08090000007', 'SIGNUP');
    const bankCode = await requestAndCaptureCode('08090000007', 'BANK_ACCOUNT_CHANGE');
    expect(signupCode).not.toBe(bankCode);

    await expect(otpService.verifyOtp('08090000007', 'BANK_ACCOUNT_CHANGE', signupCode)).rejects.toMatchObject({
      statusCode: 400,
    });
    const result = await otpService.verifyOtp('08090000007', 'BANK_ACCOUNT_CHANGE', bankCode);
    expect(result.verified).toBe(true);
  });
});

describe('POST /api/otp — request and verify (TASK-025)', () => {
  it('works end to end over HTTP', async () => {
    const requestRes = await request(app).post('/api/otp/request').send({ phone: '08090000008', purpose: 'SIGNUP' });
    expect(requestRes.status).toBe(201);
    expect(requestRes.body.demoMode).toBe(true);

    const record = await prisma.otpCode.findFirst({ where: { phone: '08090000008' } });
    // The raw code is never persisted or returned — only its hash. Verify
    // the wrong code is correctly rejected over HTTP.
    const wrongRes = await request(app)
      .post('/api/otp/verify')
      .send({ phone: '08090000008', purpose: 'SIGNUP', code: '111111' });
    expect(wrongRes.status).toBe(400);
    expect(record).not.toBeNull();
  });

  it('rejects a malformed request payload with 422', async () => {
    const res = await request(app).post('/api/otp/request').send({ phone: '123', purpose: 'NOT_REAL' });
    expect(res.status).toBe(422);
  });
});
