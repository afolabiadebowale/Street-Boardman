const request = require('supertest');
const app = require('../../server/app');
const { resetDatabase, prisma } = require('../helpers/reset');
const walletService = require('../../server/services/walletService');

let phoneCounter = 0;
async function setupBetter() {
  phoneCounter += 1;
  const phone = `0870${String(phoneCounter).padStart(7, '0')}`;
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register/better').send({ fullName: 'Reads Better', phone, pin: '1234' });
  return { agent, userId: res.body.user.id };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Ledger-derived wallet reads (TASK-018)', () => {
  it('returns zero for a freshly registered wallet with no ledger activity yet', async () => {
    const { userId } = await setupBetter();
    const wallet = await prisma.wallet.findUnique({ where: { userId } });

    const balance = await walletService.getLedgerDerivedBalance(prisma, wallet.id);
    expect(balance.toString()).toBe('0');

    const account = await prisma.ledgerAccount.findUnique({ where: { walletId: wallet.id } });
    expect(account).toBeNull(); // no account created until the first transaction
  });

  it('matches the stored balance after a deposit', async () => {
    const { agent, userId } = await setupBetter();
    await agent.post('/api/deposits/demo').send({ amount: 3000 });

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    const ledgerBalance = await walletService.getLedgerDerivedBalance(prisma, wallet.id);
    expect(ledgerBalance.toString()).toBe('3000');
    expect(Number(wallet.balance)).toBe(3000);
  });

  it('GET /api/wallet/me serves the ledger-derived balance', async () => {
    const { agent } = await setupBetter();
    await agent.post('/api/deposits/demo').send({ amount: 4500 });

    const res = await agent.get('/api/wallet/me');
    expect(res.status).toBe(200);
    expect(Number(res.body.wallet.balance)).toBe(4500);
  });

  it('reconcileWallet reports matches:true in the normal case', async () => {
    const { agent, userId } = await setupBetter();
    await agent.post('/api/deposits/demo').send({ amount: 1200 });
    const wallet = await prisma.wallet.findUnique({ where: { userId } });

    const result = await walletService.reconcileWallet(prisma, wallet.id);
    expect(result.matches).toBe(true);
    expect(result.storedBalance.toString()).toBe('1200');
    expect(result.ledgerBalance.toString()).toBe('1200');
  });

  it('reconcileWallet catches drift if the stored balance and ledger disagree', async () => {
    const { agent, userId } = await setupBetter();
    await agent.post('/api/deposits/demo').send({ amount: 1000 });
    const wallet = await prisma.wallet.findUnique({ where: { userId } });

    // Simulate a bug: directly corrupt the stored balance, bypassing
    // applyWalletTransaction entirely (which is the only path that keeps
    // the two in sync).
    await prisma.$executeRaw`UPDATE "Wallet" SET balance = 9999 WHERE id = ${wallet.id}`;

    const result = await walletService.reconcileWallet(prisma, wallet.id);
    expect(result.matches).toBe(false);
    expect(result.storedBalance.toString()).toBe('9999');
    expect(result.ledgerBalance.toString()).toBe('1000');
  });
});
