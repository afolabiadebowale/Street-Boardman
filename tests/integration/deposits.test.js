const request = require('supertest');
const app = require('../../server/app');
const { resetDatabase, prisma } = require('../helpers/reset');
const depositService = require('../../server/services/depositService');

let phoneCounter = 0;
async function setupBetter() {
  phoneCounter += 1;
  const phone = `0807${String(phoneCounter).padStart(7, '0')}`;
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/register/better')
    .send({ fullName: 'Chioma Better', phone, pin: '1234' });
  return { agent, userId: res.body.user.id };
}

async function createPendingPaystackDeposit(userId, amount, reference) {
  return prisma.deposit.create({
    data: { userId, amount, provider: 'PAYSTACK', status: 'PENDING', providerReference: reference },
  });
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('depositService.handlePaystackChargeSuccess — webhook hardening (TASK-004)', () => {
  it('credits the wallet exactly once even if the webhook is replayed', async () => {
    const { userId } = await setupBetter();
    const deposit = await createPendingPaystackDeposit(userId, 5000, 'ref-replay-1');

    await depositService.handlePaystackChargeSuccess('ref-replay-1', { amount: 500000, currency: 'NGN' });
    await depositService.handlePaystackChargeSuccess('ref-replay-1', { amount: 500000, currency: 'NGN' });

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    expect(Number(wallet.balance)).toBe(5000);

    const credits = await prisma.walletTransaction.findMany({
      where: { referenceType: 'Deposit', referenceId: deposit.id, type: 'DEPOSIT' },
    });
    expect(credits).toHaveLength(1);
  });

  it('rejects and does not credit when the webhook amount does not match the deposit', async () => {
    const { userId } = await setupBetter();
    await createPendingPaystackDeposit(userId, 5000, 'ref-tampered');

    await expect(
      depositService.handlePaystackChargeSuccess('ref-tampered', { amount: 100, currency: 'NGN' })
    ).rejects.toMatchObject({ statusCode: 400 });

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    expect(Number(wallet.balance)).toBe(0);
  });

  it('rejects and does not credit when the webhook currency does not match', async () => {
    const { userId } = await setupBetter();
    await createPendingPaystackDeposit(userId, 5000, 'ref-badcurrency');

    await expect(
      depositService.handlePaystackChargeSuccess('ref-badcurrency', { amount: 500000, currency: 'USD' })
    ).rejects.toMatchObject({ statusCode: 400 });

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    expect(Number(wallet.balance)).toBe(0);
  });
});

describe('depositService.verifyPaystackSignature — constant-time comparison (TASK-004)', () => {
  const crypto = require('crypto');
  const env = require('../../server/config/env');
  const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'x' } }));
  const sign = (secret) => crypto.createHmac('sha512', secret).update(body).digest('hex');
  let originalSecret;

  beforeEach(() => {
    originalSecret = env.paystack.webhookSecret;
  });
  afterEach(() => {
    env.paystack.webhookSecret = originalSecret;
  });

  it('accepts a correctly signed body and rejects a tampered one', () => {
    env.paystack.webhookSecret = 'test-webhook-secret';

    expect(depositService.verifyPaystackSignature(body, sign('test-webhook-secret'))).toBe(true);
    expect(depositService.verifyPaystackSignature(body, sign('some-other-secret'))).toBe(false);
    expect(depositService.verifyPaystackSignature(body, 'not-a-valid-signature')).toBe(false);
    expect(depositService.verifyPaystackSignature(body, undefined)).toBe(false);
  });

  it('rejects everything when no webhook secret is configured, even a "correct" empty-key signature', () => {
    env.paystack.webhookSecret = '';

    expect(depositService.verifyPaystackSignature(body, sign(''))).toBe(false);
  });
});
