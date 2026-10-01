const { resetDatabase, prisma } = require('../helpers/reset');

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

function loadWithdrawalServiceWithAppMode(appMode) {
  const ORIGINAL = process.env.APP_MODE;
  process.env.APP_MODE = appMode;
  jest.resetModules();
  const service = require('../../server/services/withdrawalService');
  process.env.APP_MODE = ORIGINAL;
  return service;
}

describe('withdrawalService.transferFunds stopgap (TASK-003)', () => {
  it('refuses to process a withdrawal in PRODUCTION mode (no real transfer wired up yet)', async () => {
    const user = await prisma.user.create({
      data: { role: 'BETTER', fullName: 'Prod Better', phone: '08060000001', passwordHash: 'x', kycTier: 'TIER_1' },
    });
    await prisma.wallet.create({ data: { userId: user.id, walletType: 'BETTER', balance: 5000 } });
    const admin = await prisma.user.create({
      data: { role: 'ADMIN', fullName: 'Prod Admin', phone: '08060000002', passwordHash: 'x' },
    });

    const demoWithdrawalService = loadWithdrawalServiceWithAppMode('DEMO');
    const withdrawal = await demoWithdrawalService.requestWithdrawal(user.id, 2000, {
      bankName: 'Test',
      accountNumber: '0000000000',
      accountName: 'Prod Better',
    });

    const prodWithdrawalService = loadWithdrawalServiceWithAppMode('PRODUCTION');
    await expect(prodWithdrawalService.processWithdrawal(withdrawal.id, admin.id)).rejects.toMatchObject({
      statusCode: 501,
    });

    const stillPending = await prisma.withdrawal.findUnique({ where: { id: withdrawal.id } });
    expect(stillPending.status).toBe('PENDING'); // never marked PROCESSED
  });

  it('still processes normally in DEMO mode', async () => {
    const user = await prisma.user.create({
      data: { role: 'BETTER', fullName: 'Demo Better', phone: '08060000003', passwordHash: 'x', kycTier: 'TIER_1' },
    });
    await prisma.wallet.create({ data: { userId: user.id, walletType: 'BETTER', balance: 5000 } });
    const admin = await prisma.user.create({
      data: { role: 'ADMIN', fullName: 'Demo Admin', phone: '08060000004', passwordHash: 'x' },
    });

    const demoWithdrawalService = loadWithdrawalServiceWithAppMode('DEMO');
    const withdrawal = await demoWithdrawalService.requestWithdrawal(user.id, 2000, {
      bankName: 'Test',
      accountNumber: '0000000000',
      accountName: 'Demo Better',
    });

    const processed = await demoWithdrawalService.processWithdrawal(withdrawal.id, admin.id);
    expect(processed.status).toBe('PROCESSED');
  });
});
