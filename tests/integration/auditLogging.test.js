const request = require('supertest');
const app = require('../../server/app');
const { resetDatabase, prisma } = require('../helpers/reset');
const adminService = require('../../server/services/adminService');
const withdrawalService = require('../../server/services/withdrawalService');
const resultService = require('../../server/services/resultService');
const settingsService = require('../../server/services/settingsService');

let userCounter = 0;
async function setupAdmin() {
  userCounter += 1;
  const admin = await prisma.user.create({
    data: { role: 'ADMIN', fullName: 'Audit Admin', phone: `0820${String(userCounter).padStart(7, '0')}`, passwordHash: 'x' },
  });
  await prisma.wallet.create({ data: { userId: admin.id, walletType: 'PLATFORM', balance: 0 } });
  return admin.id;
}

async function setupApprovedBoardman(adminId) {
  userCounter += 1;
  const boardmanAgent = request.agent(app);
  const res = await boardmanAgent.post('/api/auth/register/boardman').send({
    fullName: 'Audit Boardman',
    phone: `0821${String(userCounter).padStart(7, '0')}`,
    pin: '1234',
    businessLocation: 'Lagos',
  });
  const boardmanUserId = res.body.user.id;
  const profile = await prisma.boardmanProfile.findUnique({ where: { userId: boardmanUserId } });
  await adminService.approveBoardman(profile.id, adminId);
  return { boardmanAgent };
}

async function setupFundedBetter(amount = 20000) {
  userCounter += 1;
  const phone = `0822${String(userCounter).padStart(7, '0')}`;
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register/better').send({ fullName: 'Audit Better', phone, pin: '1234' });
  await agent.post('/api/deposits/demo').send({ amount });
  // Withdrawals require TIER_1 KYC (TASK-027) — not what these tests
  // are exercising, so treat the user as already verified.
  await prisma.user.update({ where: { id: res.body.user.id }, data: { kycTier: 'TIER_1' } });
  return { agent, userId: res.body.user.id };
}

async function auditLogsFor(entityType, entityId) {
  return prisma.auditLog.findMany({ where: { entityType, entityId } });
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Audit log coverage (TASK-012)', () => {
  it('logs a setting change', async () => {
    const adminId = await setupAdmin();
    await settingsService.updateSetting('platformCommissionRate', 0.04, adminId);

    const logs = await auditLogsFor('SystemSetting', 'platformCommissionRate');
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('SETTING_UPDATED');
  });

  it('logs a processed withdrawal', async () => {
    const adminId = await setupAdmin();
    const { userId } = await setupFundedBetter(10000);
    const withdrawal = await withdrawalService.requestWithdrawal(userId, 3000, {
      bankName: 'Test',
      accountNumber: '0000000000',
      accountName: 'Audit Better',
    });

    await withdrawalService.processWithdrawal(withdrawal.id, adminId);

    const logs = await auditLogsFor('Withdrawal', withdrawal.id);
    expect(logs.some((l) => l.action === 'WITHDRAWAL_PROCESSED')).toBe(true);
  });

  it('logs a rejected withdrawal', async () => {
    const adminId = await setupAdmin();
    const { userId } = await setupFundedBetter(10000);
    const withdrawal = await withdrawalService.requestWithdrawal(userId, 3000, {
      bankName: 'Test',
      accountNumber: '0000000000',
      accountName: 'Audit Better',
    });

    await withdrawalService.rejectWithdrawal(withdrawal.id, adminId, 'Suspicious');

    const logs = await auditLogsFor('Withdrawal', withdrawal.id);
    expect(logs.some((l) => l.action === 'WITHDRAWAL_REJECTED')).toBe(true);
  });

  it('logs a dispute resolved CONFIRM', async () => {
    const adminId = await setupAdmin();
    const { boardmanAgent } = await setupApprovedBoardman(adminId);
    const { agent: bettor } = await setupFundedBetter(10000);

    const deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const createRes = await boardmanAgent.post('/api/competitions').send({
      title: 'Audit Dispute Test',
      category: 'FOOTBALL',
      bettingDeadline: deadline,
      options: ['Home', 'Away'],
    });
    const competitionId = createRes.body.competition.id;
    const home = createRes.body.competition.betOptions.find((o) => o.label === 'Home');

    await bettor.post('/api/bets').send({ betOptionId: home.id, stake: 2000 });
    await boardmanAgent.patch(`/api/competitions/${competitionId}/close-betting`);
    await boardmanAgent.post(`/api/competitions/${competitionId}/result`).send({ winningOptionId: home.id });
    const disputeRes = await bettor.post(`/api/competitions/${competitionId}/dispute`).send({ reason: 'Wrong result' });
    const disputeId = disputeRes.body.dispute.id;

    await resultService.resolveDispute(adminId, disputeId, { action: 'CONFIRM', winningOptionId: home.id });

    const logs = await auditLogsFor('Dispute', disputeId);
    expect(logs.some((l) => l.action === 'DISPUTE_RESOLVED_CONFIRMED')).toBe(true);
  });
});
