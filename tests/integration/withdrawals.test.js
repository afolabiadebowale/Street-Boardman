const request = require('supertest');
const app = require('../../server/app');
const { resetDatabase, prisma } = require('../helpers/reset');
const withdrawalService = require('../../server/services/withdrawalService');

let betterPhoneCounter = 0;
async function setupFundedBetter(amount = 20000) {
  betterPhoneCounter += 1;
  const phone = `0806${String(betterPhoneCounter).padStart(7, '0')}`;
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/register/better')
    .send({ fullName: 'Wale Better', phone, pin: '1234' });
  await agent.post('/api/deposits/demo').send({ amount });
  // Withdrawals require TIER_1 KYC (TASK-027) — these tests are about
  // withdrawal atomicity/behaviour, not KYC gating itself, so treat the
  // user as already verified.
  await prisma.user.update({ where: { id: res.body.user.id }, data: { kycTier: 'TIER_1' } });
  return { agent, userId: res.body.user.id };
}

let adminPhoneCounter = 0;
async function setupAdmin() {
  adminPhoneCounter += 1;
  const admin = await prisma.user.create({
    data: {
      role: 'ADMIN',
      fullName: 'Withdrawal Admin',
      phone: `0813${String(adminPhoneCounter).padStart(7, '0')}`,
      passwordHash: 'x',
    },
  });
  return admin.id;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('withdrawalService — atomic approve/reject (TASK-002)', () => {
  it('never applies two refunds when reject is called concurrently on the same withdrawal', async () => {
    const { userId } = await setupFundedBetter(10000);
    const adminId = await setupAdmin();
    const withdrawal = await withdrawalService.requestWithdrawal(userId, 5000, {
      bankName: 'Test Bank',
      accountNumber: '0123456789',
      accountName: 'Wale Better',
    });

    const results = await Promise.allSettled([
      withdrawalService.rejectWithdrawal(withdrawal.id, adminId, 'race A'),
      withdrawalService.rejectWithdrawal(withdrawal.id, adminId, 'race B'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    // Started with 10000, withdrew 5000 (-> 5000), rejection refunds it once (-> 10000).
    // If both rejects had applied, this would be 15000.
    expect(Number(wallet.balance)).toBe(10000);

    const refundTx = await prisma.walletTransaction.findMany({
      where: { referenceType: 'Withdrawal', referenceId: withdrawal.id, type: 'ADJUSTMENT' },
    });
    expect(refundTx).toHaveLength(1);
  });

  it('never lets process and reject both succeed on the same withdrawal', async () => {
    const { userId } = await setupFundedBetter(10000);
    const adminId = await setupAdmin();
    const withdrawal = await withdrawalService.requestWithdrawal(userId, 5000, {
      bankName: 'Test Bank',
      accountNumber: '0123456789',
      accountName: 'Wale Better',
    });

    const results = await Promise.allSettled([
      withdrawalService.processWithdrawal(withdrawal.id, adminId),
      withdrawalService.rejectWithdrawal(withdrawal.id, adminId, 'race'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);

    const final = await prisma.withdrawal.findUnique({ where: { id: withdrawal.id } });
    expect(['PROCESSED', 'REJECTED']).toContain(final.status);
  });
});
