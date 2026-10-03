// TASK-021/024: real payouts through Paystack Transfers, against a mocked
// Paystack. What has to hold with real money: at most one transfer per
// withdrawal, every failure returns the funds exactly once, and an
// unknown outcome is confirmed before anything else happens.
jest.mock('../../server/services/paystackClient', () => {
  const actual = jest.requireActual('../../server/services/paystackClient');
  return {
    PaystackError: actual.PaystackError,
    createTransferRecipient: jest.fn(),
    initiateTransfer: jest.fn(),
    verifyTransfer: jest.fn(),
    getNgnBalanceKobo: jest.fn(),
  };
});

const crypto = require('crypto');
const request = require('supertest');
const app = require('../../server/app');
const env = require('../../server/config/env');
const paystack = require('../../server/services/paystackClient');
const withdrawalService = require('../../server/services/withdrawalService');
const { resetDatabase, prisma } = require('../helpers/reset');
const password = require('../../server/utils/password');

const { PaystackError } = paystack;
const WEBHOOK_SECRET = 'payout-test-webhook-secret';
const DESTINATION = { bankName: 'GTBank', bankCode: '058', accountNumber: '0123456789', accountName: 'Ada Better' };

let original;
let counter = 0;

beforeAll(() => {
  original = { appMode: env.appMode, paystack: { ...env.paystack } };
});

beforeEach(async () => {
  await resetDatabase();
  jest.clearAllMocks();
  env.appMode = 'PRODUCTION';
  env.paystack.secretKey = 'sk_test_payouts';
  env.paystack.webhookSecret = WEBHOOK_SECRET;
  paystack.getNgnBalanceKobo.mockResolvedValue(10_000_000); // NGN 100,000
  paystack.createTransferRecipient.mockResolvedValue({ recipient_code: 'RCP_test' });
  paystack.initiateTransfer.mockResolvedValue({ status: 'pending', transfer_code: 'TRF_test' });
});

afterAll(async () => {
  env.appMode = original.appMode;
  Object.assign(env.paystack, original.paystack);
  await prisma.$disconnect();
});

async function setup({ balance = 5000, amount = 2000 } = {}) {
  counter += 1;
  const user = await prisma.user.create({
    data: { role: 'BETTER', fullName: 'Ada Better', phone: `0807${String(counter).padStart(7, '0')}`, passwordHash: 'x', kycTier: 'TIER_1' },
  });
  await prisma.wallet.create({ data: { userId: user.id, walletType: 'BETTER', balance } });
  const admin = await prisma.user.create({
    data: { role: 'ADMIN', fullName: 'Finance', phone: `0817${String(counter).padStart(7, '0')}`, passwordHash: 'x' },
  });
  const withdrawal = await withdrawalService.requestWithdrawal(user.id, amount, DESTINATION);
  return { user, admin, withdrawal };
}

const balanceOf = async (userId) => Number((await prisma.wallet.findUnique({ where: { userId } })).balance);
const statusOf = async (id) => (await prisma.withdrawal.findUnique({ where: { id } })).status;

function sendWebhook(event, data) {
  const body = JSON.stringify({ event, data });
  const signature = crypto.createHmac('sha512', WEBHOOK_SECRET).update(body).digest('hex');
  return request(app)
    .post('/api/deposits/paystack/webhook')
    .set('Content-Type', 'application/json')
    .set('x-paystack-signature', signature)
    .send(body);
}

describe('Paystack payouts (TASK-021)', () => {
  it('sends one transfer with a deterministic reference and settles it from the webhook', async () => {
    const { withdrawal, admin } = await setup();

    const processing = await withdrawalService.processWithdrawal(withdrawal.id, admin.id);
    expect(processing.status).toBe('PROCESSING');
    expect(processing.transferReference).toBe(`wd_${withdrawal.id}`);
    expect(processing.transferCode).toBe('TRF_test');
    expect(paystack.createTransferRecipient).toHaveBeenCalledWith({
      name: 'Ada Better',
      accountNumber: '0123456789',
      bankCode: '058',
    });
    expect(paystack.initiateTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ amountKobo: 200000, recipientCode: 'RCP_test', reference: `wd_${withdrawal.id}` })
    );

    const data = { reference: `wd_${withdrawal.id}`, amount: 200000, transfer_code: 'TRF_test' };
    expect((await sendWebhook('transfer.success', data)).status).toBe(200);
    expect(await statusOf(withdrawal.id)).toBe('PROCESSED');

    // Paystack retries webhooks: a repeat changes nothing.
    expect((await sendWebhook('transfer.success', data)).status).toBe(200);
    const audits = await prisma.auditLog.count({ where: { entityId: withdrawal.id, action: 'WITHDRAWAL_PROCESSED' } });
    expect(audits).toBe(1);
  });

  it('lets only one of two simultaneous admin clicks reach Paystack', async () => {
    const { withdrawal, admin } = await setup();

    const results = await Promise.allSettled([
      withdrawalService.processWithdrawal(withdrawal.id, admin.id),
      withdrawalService.processWithdrawal(withdrawal.id, admin.id),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(paystack.initiateTransfer).toHaveBeenCalledTimes(1);
  });

  it('returns the money exactly once when the transfer fails', async () => {
    const { withdrawal, admin, user } = await setup({ balance: 5000, amount: 2000 });
    await withdrawalService.processWithdrawal(withdrawal.id, admin.id);
    expect(await balanceOf(user.id)).toBe(3000);

    const data = { reference: `wd_${withdrawal.id}`, amount: 200000 };
    await sendWebhook('transfer.failed', data);
    await sendWebhook('transfer.failed', data);

    expect(await statusOf(withdrawal.id)).toBe('FAILED');
    expect(await balanceOf(user.id)).toBe(5000);
  });

  it('refunds a transfer that Paystack reverses after reporting success', async () => {
    const { withdrawal, admin, user } = await setup({ balance: 5000, amount: 2000 });
    await withdrawalService.processWithdrawal(withdrawal.id, admin.id);
    const data = { reference: `wd_${withdrawal.id}`, amount: 200000 };
    await sendWebhook('transfer.success', data);
    await sendWebhook('transfer.reversed', data);

    expect(await statusOf(withdrawal.id)).toBe('FAILED');
    expect(await balanceOf(user.id)).toBe(5000);
  });

  it('puts the withdrawal back to pending when Paystack rejects the bank details, and allows a retry', async () => {
    const { withdrawal, admin } = await setup();
    paystack.createTransferRecipient.mockRejectedValueOnce(
      new PaystackError('Could not resolve account name', { rejected: true, status: 422 })
    );

    await expect(withdrawalService.processWithdrawal(withdrawal.id, admin.id)).rejects.toMatchObject({ statusCode: 502 });
    const reverted = await prisma.withdrawal.findUnique({ where: { id: withdrawal.id } });
    expect(reverted.status).toBe('PENDING');
    expect(reverted.failureReason).toMatch(/Bank details rejected/);
    expect(paystack.initiateTransfer).not.toHaveBeenCalled();

    const retried = await withdrawalService.processWithdrawal(withdrawal.id, admin.id);
    expect(retried.status).toBe('PROCESSING');
  });

  it('checks a rejected transfer by reference: not found goes back to pending, found settles', async () => {
    const first = await setup();
    paystack.initiateTransfer.mockRejectedValueOnce(new PaystackError('Insufficient balance', { rejected: true, status: 400 }));
    paystack.verifyTransfer.mockRejectedValueOnce(new PaystackError('Transfer not found', { rejected: true, status: 404 }));
    await expect(withdrawalService.processWithdrawal(first.withdrawal.id, first.admin.id)).rejects.toMatchObject({
      statusCode: 502,
    });
    expect(await statusOf(first.withdrawal.id)).toBe('PENDING');

    // A "duplicate reference" style rejection where the transfer did go through.
    const second = await setup();
    paystack.initiateTransfer.mockRejectedValueOnce(new PaystackError('Duplicate reference', { rejected: true, status: 400 }));
    paystack.verifyTransfer.mockResolvedValueOnce({ status: 'success', transfer_code: 'TRF_dup' });
    const settled = await withdrawalService.processWithdrawal(second.withdrawal.id, second.admin.id);
    expect(settled.status).toBe('PROCESSED');
  });

  it('keeps an unknown outcome in PROCESSING until the sweep confirms it with Paystack', async () => {
    const lost = await setup();
    const never = await setup();
    paystack.initiateTransfer.mockRejectedValue(new PaystackError('timeout of 15000ms exceeded', { rejected: false }));

    for (const { withdrawal, admin } of [lost, never]) {
      await expect(withdrawalService.processWithdrawal(withdrawal.id, admin.id)).rejects.toMatchObject({ statusCode: 502 });
      expect(await statusOf(withdrawal.id)).toBe('PROCESSING');
    }

    // Too recent: the sweep leaves them alone.
    expect((await withdrawalService.confirmStuckTransfers()).checked).toBe(0);

    paystack.verifyTransfer.mockImplementation(async (reference) => {
      if (reference === `wd_${lost.withdrawal.id}`) return { status: 'success', transfer_code: 'TRF_lost' };
      throw new PaystackError('Transfer not found', { rejected: true, status: 404 });
    });
    const later = new Date(Date.now() + 20 * 60 * 1000);
    expect((await withdrawalService.confirmStuckTransfers({ now: later })).checked).toBe(2);

    expect(await statusOf(lost.withdrawal.id)).toBe('PROCESSED');
    expect(await statusOf(never.withdrawal.id)).toBe('PENDING');
  });

  it('ignores webhooks with an amount that does not match, and ones for unknown references', async () => {
    const { withdrawal, admin } = await setup();
    await withdrawalService.processWithdrawal(withdrawal.id, admin.id);

    const mismatch = await sendWebhook('transfer.success', { reference: `wd_${withdrawal.id}`, amount: 1 });
    expect(mismatch.status).toBe(400);
    expect(await statusOf(withdrawal.id)).toBe('PROCESSING');

    const unknown = await sendWebhook('transfer.success', { reference: 'wd_not_ours', amount: 200000 });
    expect(unknown.status).toBe(200);
  });

  it('refuses a real withdrawal request without a bank code, before touching the wallet', async () => {
    const { user } = await setup({ balance: 5000, amount: 1000 });
    const before = await balanceOf(user.id);

    await expect(
      withdrawalService.requestWithdrawal(user.id, 1000, { bankName: 'GTBank', accountNumber: '0123456789', accountName: 'Ada' })
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(await balanceOf(user.id)).toBe(before);
  });
});

describe('Payout float (TASK-024)', () => {
  it('does not start a transfer the Paystack balance cannot cover', async () => {
    const { withdrawal, admin } = await setup({ amount: 2000 });
    paystack.getNgnBalanceKobo.mockResolvedValueOnce(100000); // NGN 1,000

    await expect(withdrawalService.processWithdrawal(withdrawal.id, admin.id)).rejects.toMatchObject({ statusCode: 503 });
    expect(await statusOf(withdrawal.id)).toBe('PENDING');
    expect(paystack.createTransferRecipient).not.toHaveBeenCalled();
  });

  it('flags the float as low when it cannot cover pending withdrawals plus the margin', async () => {
    await setup({ amount: 2000 });
    await setup({ amount: 3000 });
    paystack.getNgnBalanceKobo.mockResolvedValue((5000 + env.payouts.floatAlertNgn - 1) * 100);

    const low = await withdrawalService.checkPayoutFloat();
    expect(low).toMatchObject({ live: true, owedNgn: 5000, low: true });

    paystack.getNgnBalanceKobo.mockResolvedValue((5000 + env.payouts.floatAlertNgn) * 100);
    expect((await withdrawalService.checkPayoutFloat()).low).toBe(false);
  });

  it('is served to finance staff only', async () => {
    const passwordHash = await password.hash('1234');
    const agentFor = async (staffRole, phone) => {
      await prisma.user.create({ data: { role: 'ADMIN', fullName: 'Staff', phone, passwordHash, staffRole } });
      const agent = request.agent(app);
      await agent.post('/api/auth/login').send({ phone, pin: '1234' });
      return agent;
    };
    const finance = await agentFor('FINANCE', '09200000001');
    const support = await agentFor('SUPPORT', '09200000002');

    const ok = await finance.get('/api/admin/payouts/float');
    expect(ok.status).toBe(200);
    expect(ok.body.float).toMatchObject({ live: true, low: false });
    expect((await support.get('/api/admin/payouts/float')).status).toBe(403);
  });
});
