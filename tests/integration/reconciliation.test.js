const request = require('supertest');
const app = require('../../server/app');
const { resetDatabase, prisma } = require('../helpers/reset');
const reconciliationService = require('../../server/services/reconciliationService');
const logger = require('../../server/utils/logger');

let phoneCounter = 0;
async function setupFundedBetter(amount = 5000) {
  phoneCounter += 1;
  const phone = `0880${String(phoneCounter).padStart(7, '0')}`;
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register/better').send({ fullName: 'Recon Better', phone, pin: '1234' });
  await agent.post('/api/deposits/demo').send({ amount });
  return { agent, userId: res.body.user.id };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('reconciliationService (TASK-020)', () => {
  it('reports allMatch:true across every wallet in the normal case', async () => {
    await setupFundedBetter(3000);
    await setupFundedBetter(7000);

    const report = await reconciliationService.reconcileAllWallets();
    expect(report.totalWallets).toBeGreaterThanOrEqual(2);
    expect(report.allMatch).toBe(true);
    expect(report.mismatches).toHaveLength(0);
  });

  it('flags exactly the wallet that has drifted, leaving the rest matched', async () => {
    const { userId: goodUserId } = await setupFundedBetter(3000);
    const { userId: badUserId } = await setupFundedBetter(7000);
    const badWallet = await prisma.wallet.findUnique({ where: { userId: badUserId } });

    await prisma.$executeRaw`UPDATE "Wallet" SET balance = 12345 WHERE id = ${badWallet.id}`;

    const report = await reconciliationService.reconcileAllWallets();
    expect(report.allMatch).toBe(false);
    expect(report.mismatches).toHaveLength(1);
    expect(report.mismatches[0].walletId).toBe(badWallet.id);

    const goodWallet = await prisma.wallet.findUnique({ where: { userId: goodUserId } });
    expect(report.mismatches.some((m) => m.walletId === goodWallet.id)).toBe(false);
  });

  it('runDailyReconciliation returns a pass report and logs it', async () => {
    await setupFundedBetter(1000);
    const logSpy = jest.spyOn(logger, 'info');

    const report = await reconciliationService.runDailyReconciliation();

    expect(report.pass).toBe(true);
    expect(report.wallets.mismatched).toBe(0);
    expect(report.providerSettlement).toMatch(/not_yet_available/);
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ event: 'daily_reconciliation', pass: true }), expect.any(String));

    logSpy.mockRestore();
  });

  it('runDailyReconciliation logs at error level when something fails to reconcile', async () => {
    const { userId } = await setupFundedBetter(1000);
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    await prisma.$executeRaw`UPDATE "Wallet" SET balance = 999999 WHERE id = ${wallet.id}`;

    const errorSpy = jest.spyOn(logger, 'error');

    const report = await reconciliationService.runDailyReconciliation();

    expect(report.pass).toBe(false);
    const logged = errorSpy.mock.calls[0][0];
    expect(logged).toMatchObject({ event: 'daily_reconciliation', pass: false });
    expect(logged.mismatches.some((m) => m.walletId === wallet.id)).toBe(true);

    errorSpy.mockRestore();
  });
});
