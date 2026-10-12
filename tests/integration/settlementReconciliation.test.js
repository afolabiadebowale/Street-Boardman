// Paystack settlement reconciliation (TASK-020), against a mocked Paystack:
// yesterday's charges and transfers checked against our deposits and
// withdrawals.
jest.mock('../../server/services/paystackClient', () => {
  const actual = jest.requireActual('../../server/services/paystackClient');
  return { ...actual, listTransactions: jest.fn(), listTransfers: jest.fn() };
});

const env = require('../../server/config/env');
const paystack = require('../../server/services/paystackClient');
const settlementService = require('../../server/services/settlementService');
const depositService = require('../../server/services/depositService');
const reconciliationService = require('../../server/services/reconciliationService');
const { resetDatabase, prisma } = require('../helpers/reset');

const NOW = new Date('2026-10-12T08:00:00Z');
const YESTERDAY = new Date('2026-10-11T12:00:00Z');
let original;
let counter = 0;

beforeAll(() => {
  original = { appMode: env.appMode, secretKey: env.paystack.secretKey };
});

beforeEach(async () => {
  await resetDatabase();
  jest.clearAllMocks();
  env.appMode = 'PRODUCTION';
  env.paystack.secretKey = 'sk_test_settlement';
  paystack.listTransactions.mockResolvedValue({ data: [], meta: { page: 1, pageCount: 1 } });
  paystack.listTransfers.mockResolvedValue({ data: [], meta: { page: 1, pageCount: 1 } });
});

afterAll(async () => {
  env.appMode = original.appMode;
  env.paystack.secretKey = original.secretKey;
  await prisma.$disconnect();
});

async function better() {
  counter += 1;
  const user = await prisma.user.create({
    data: { role: 'BETTER', fullName: 'Ada', phone: `0818${String(counter).padStart(7, '0')}`, passwordHash: 'x' },
  });
  await prisma.wallet.create({ data: { userId: user.id, walletType: 'BETTER', balance: 0 } });
  return user;
}

const deposit = (userId, amount, reference, extra = {}) =>
  prisma.deposit.create({ data: { userId, amount, provider: 'PAYSTACK', status: 'PENDING', providerReference: reference, ...extra } });
const charge = (reference, amountKobo) => ({ reference, amount: amountKobo, status: 'success', currency: 'NGN' });
const balanceOf = async (userId) => Number((await prisma.wallet.findUnique({ where: { userId } })).balance);

describe('Paystack settlement reconciliation (TASK-020)', () => {
  it('credits a charge whose webhook never arrived, once, and audits it', async () => {
    const user = await better();
    const lost = await deposit(user.id, 5000, 'dep-lost');
    paystack.listTransactions.mockResolvedValue({ data: [charge('dep-lost', 500000)], meta: { page: 1, pageCount: 1 } });

    const report = await settlementService.reconcileSettlement({ now: NOW });
    expect(report).toMatchObject({ status: 'ok', deposits: { checked: 1, healed: 1 } });
    expect(await balanceOf(user.id)).toBe(5000);
    expect((await prisma.deposit.findUnique({ where: { id: lost.id } })).status).toBe('SUCCESSFUL');
    expect(await prisma.auditLog.count({ where: { action: 'DEPOSIT_CREDITED_BY_RECONCILIATION', entityId: lost.id } })).toBe(1);

    // Running it again changes nothing.
    expect((await settlementService.reconcileSettlement({ now: NOW })).deposits.healed).toBe(0);
    expect(await balanceOf(user.id)).toBe(5000);
  });

  it('reports, and never auto-fixes, a credit Paystack has no charge for', async () => {
    const user = await better();
    await deposit(user.id, 2000, 'dep-phantom', { status: 'SUCCESSFUL', verifiedAt: YESTERDAY });

    const report = await settlementService.reconcileSettlement({ now: NOW });
    expect(report.status).toBe('mismatch');
    expect(report.problems).toEqual([expect.objectContaining({ kind: 'credited_without_charge', reference: 'dep-phantom' })]);
  });

  it('reports amount mismatches and charges we have no deposit for', async () => {
    const user = await better();
    await deposit(user.id, 5000, 'dep-short');
    paystack.listTransactions.mockResolvedValue({
      data: [charge('dep-short', 400000), charge('dep-unknown', 100000)],
      meta: { page: 1, pageCount: 1 },
    });

    const report = await settlementService.reconcileSettlement({ now: NOW });
    expect(report.problems.map((p) => p.kind).sort()).toEqual(['amount_mismatch', 'charge_without_deposit']);
    expect(await balanceOf(user.id)).toBe(0);
  });

  it('pages through every result', async () => {
    const user = await better();
    await deposit(user.id, 100, 'dep-p1');
    await deposit(user.id, 200, 'dep-p2');
    paystack.listTransactions
      .mockResolvedValueOnce({ data: [charge('dep-p1', 10000)], meta: { page: 1, pageCount: 2 } })
      .mockResolvedValueOnce({ data: [charge('dep-p2', 20000)], meta: { page: 2, pageCount: 2 } });

    const report = await settlementService.reconcileSettlement({ now: NOW });
    expect(report.deposits).toEqual({ checked: 2, healed: 2 });
    expect(await balanceOf(user.id)).toBe(300);
  });

  it('flags a payout whose status disagrees with Paystack, but leaves in-flight ones to the sweep', async () => {
    const user = await better();
    const paid = await prisma.withdrawal.create({
      data: { userId: user.id, amount: 1000, destination: {}, status: 'PROCESSED', transferReference: 'wd_paid' },
    });
    await prisma.withdrawal.create({
      data: { userId: user.id, amount: 500, destination: {}, status: 'PROCESSING', transferReference: 'wd_inflight' },
    });
    paystack.listTransfers.mockResolvedValue({
      data: [
        { reference: 'wd_paid', amount: 100000, status: 'reversed' },
        { reference: 'wd_inflight', amount: 50000, status: 'success' },
        { reference: 'someone-elses-transfer', amount: 1, status: 'success' },
      ],
      meta: { page: 1, pageCount: 1 },
    });

    const report = await settlementService.reconcileSettlement({ now: NOW });
    expect(report.problems).toEqual([
      expect.objectContaining({ kind: 'status_mismatch', reference: 'wd_paid', ours: 'PROCESSED', paystack: 'reversed' }),
    ]);
    expect((await prisma.withdrawal.findUnique({ where: { id: paid.id } })).status).toBe('PROCESSED');
  });

  it('asks Paystack for yesterday (UTC) only', async () => {
    await settlementService.reconcileSettlement({ now: NOW });
    expect(paystack.listTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ from: new Date('2026-10-11T00:00:00Z'), to: new Date('2026-10-12T00:00:00Z'), page: 1 })
    );
  });

  it('fails the daily reconciliation when Paystack disagrees or is unreachable', async () => {
    const user = await better();
    await deposit(user.id, 2000, 'dep-phantom', { status: 'SUCCESSFUL', verifiedAt: new Date(Date.now() - 24 * 3600 * 1000) });
    await prisma.walletTransaction.deleteMany();

    paystack.listTransactions.mockRejectedValueOnce(new Error('Paystack is down'));
    const down = await reconciliationService.runDailyReconciliation();
    expect(down.providerSettlement.status).toBe('error');
    expect(down.pass).toBe(false);
  });
});

describe('Deposit credit is claimed atomically (regression)', () => {
  it('credits once when the webhook and the reconciliation arrive together', async () => {
    env.appMode = 'DEMO';
    const user = await better();
    await deposit(user.id, 3000, 'dep-race');

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => depositService.handlePaystackChargeSuccess('dep-race', { amount: 300000, currency: 'NGN' }))
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await balanceOf(user.id)).toBe(3000);
    expect(await prisma.walletTransaction.count({ where: { referenceType: 'Deposit' } })).toBe(1);
  });

  it('skips the provider check in DEMO mode', async () => {
    env.appMode = 'DEMO';
    expect(await settlementService.reconcileSettlement()).toMatchObject({ status: 'skipped' });
    expect(paystack.listTransactions).not.toHaveBeenCalled();
  });
});
