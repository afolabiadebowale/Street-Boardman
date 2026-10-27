describe('depositService.createDemoDeposit — APP_MODE gating (TASK-001)', () => {
  afterEach(() => {
    jest.resetModules();
  });

  it('rejects demo deposits when APP_MODE is PRODUCTION', async () => {
    jest.resetModules();
    jest.doMock('../../server/config/env', () => ({
      appMode: 'PRODUCTION',
      paystack: { secretKey: '', publicKey: '', webhookSecret: '' },
    }));
    const depositService = require('../../server/services/depositService');

    await expect(depositService.createDemoDeposit('user-1', 1000)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('allows demo deposits when APP_MODE is DEMO (guard does not block the normal path)', async () => {
    jest.resetModules();
    jest.doMock('../../server/config/env', () => ({
      appMode: 'DEMO',
      paystack: { secretKey: '', publicKey: '', webhookSecret: '' },
    }));
    jest.doMock('../../server/config/db', () => ({
      gamblingLimit: { findMany: jest.fn().mockResolvedValue([]) }, // no deposit limits set
      $transaction: jest.fn((cb) =>
        cb({
          deposit: { create: jest.fn().mockResolvedValue({ id: 'dep-1' }) },
        })
      ),
    }));
    jest.doMock('../../server/services/walletService', () => ({
      getWalletByUserId: jest.fn().mockResolvedValue({ id: 'wallet-1' }),
      applyWalletTransaction: jest.fn().mockResolvedValue({}),
    }));
    const depositService = require('../../server/services/depositService');

    await expect(depositService.createDemoDeposit('user-1', 1000)).resolves.toBeDefined();
  });
});
