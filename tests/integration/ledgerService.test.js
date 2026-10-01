const { resetDatabase, prisma } = require('../helpers/reset');
const ledgerService = require('../../server/services/ledgerService');

async function makeWallet(walletType = 'BETTER', phoneSuffix = '1') {
  const user = await prisma.user.create({
    data: { role: walletType === 'BETTER' ? 'BETTER' : 'ADMIN', fullName: 'Ledger User', phone: `0840000000${phoneSuffix}`, passwordHash: 'x' },
  });
  return prisma.wallet.create({ data: { userId: user.id, walletType, balance: 0 } });
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('ledgerService (TASK-016)', () => {
  it('posts a balanced two-leg group and both legs share one groupId', async () => {
    const walletA = await makeWallet('BETTER', '1');
    const walletB = await makeWallet('PLATFORM', '2');

    const { groupId } = await prisma.$transaction(async (tx) => {
      const accountA = await ledgerService.getOrCreateAccountForWallet(tx, walletA);
      const accountB = await ledgerService.getOrCreateAccountForWallet(tx, walletB);
      return ledgerService.postLedgerGroup(tx, [
        { accountId: accountA.id, direction: 'CREDIT', amount: 1000, referenceType: 'Test', referenceId: 't1' },
        { accountId: accountB.id, direction: 'DEBIT', amount: 1000, referenceType: 'Test', referenceId: 't1' },
      ]);
    });

    const entries = await prisma.ledgerEntry.findMany({ where: { groupId } });
    expect(entries).toHaveLength(2);
  });

  it('rejects and writes nothing when debits and credits do not balance', async () => {
    const walletA = await makeWallet('BETTER', '3');
    const walletB = await makeWallet('PLATFORM', '4');

    await expect(
      prisma.$transaction(async (tx) => {
        const accountA = await ledgerService.getOrCreateAccountForWallet(tx, walletA);
        const accountB = await ledgerService.getOrCreateAccountForWallet(tx, walletB);
        return ledgerService.postLedgerGroup(tx, [
          { accountId: accountA.id, direction: 'CREDIT', amount: 1000, referenceType: 'Test', referenceId: 't2' },
          { accountId: accountB.id, direction: 'DEBIT', amount: 999, referenceType: 'Test', referenceId: 't2' },
        ]);
      })
    ).rejects.toThrow(/does not balance/);

    const entries = await prisma.ledgerEntry.findMany({ where: { referenceType: 'Test', referenceId: 't2' } });
    expect(entries).toHaveLength(0);
  });

  it('supports a multi-leg group (one debit funding multiple credits), matching the payout shape', async () => {
    const escrowCompetition = await createCompetitionForEscrow();
    const winnerWallet = await makeWallet('BETTER', '5');
    const boardmanWallet = await makeWallet('BOARDMAN', '6');
    const platformWallet = await makeWallet('PLATFORM', '7');

    await prisma.$transaction(async (tx) => {
      const escrowAccount = await ledgerService.getOrCreateEscrowAccountForCompetition(tx, escrowCompetition.id);
      const winnerAccount = await ledgerService.getOrCreateAccountForWallet(tx, winnerWallet);
      const boardmanAccount = await ledgerService.getOrCreateAccountForWallet(tx, boardmanWallet);
      const platformAccount = await ledgerService.getOrCreateAccountForWallet(tx, platformWallet);

      await ledgerService.postLedgerGroup(tx, [
        { accountId: escrowAccount.id, direction: 'DEBIT', amount: 1000, referenceType: 'Payout', referenceId: 'p1' },
        { accountId: winnerAccount.id, direction: 'CREDIT', amount: 920, referenceType: 'Payout', referenceId: 'p1' },
        { accountId: boardmanAccount.id, direction: 'CREDIT', amount: 50, referenceType: 'Payout', referenceId: 'p1' },
        { accountId: platformAccount.id, direction: 'CREDIT', amount: 30, referenceType: 'Payout', referenceId: 'p1' },
      ]);

      const escrowBalance = await ledgerService.getAccountBalance(tx, escrowAccount.id);
      const winnerBalance = await ledgerService.getAccountBalance(tx, winnerAccount.id);
      expect(escrowBalance.toString()).toBe('-1000');
      expect(winnerBalance.toString()).toBe('920');
    });
  });

  it('getOrCreateAccountForWallet is idempotent (no duplicate accounts)', async () => {
    const wallet = await makeWallet('BETTER', '8');
    await prisma.$transaction(async (tx) => {
      const first = await ledgerService.getOrCreateAccountForWallet(tx, wallet);
      const second = await ledgerService.getOrCreateAccountForWallet(tx, wallet);
      expect(first.id).toBe(second.id);
    });
    const accounts = await prisma.ledgerAccount.findMany({ where: { walletId: wallet.id } });
    expect(accounts).toHaveLength(1);
  });
});

async function createCompetitionForEscrow() {
  const boardmanUser = await prisma.user.create({
    data: { role: 'BOARDMAN', fullName: 'Escrow Boardman', phone: '08450000001', passwordHash: 'x' },
  });
  const profile = await prisma.boardmanProfile.create({
    data: { userId: boardmanUser.id, businessLocation: 'Lagos', approvalStatus: 'APPROVED' },
  });
  return prisma.competition.create({
    data: {
      boardmanProfileId: profile.id,
      title: 'Escrow Test',
      category: 'FOOTBALL',
      bettingDeadline: new Date(Date.now() + 3600000),
      boardmanCommissionRate: 0.05,
      platformCommissionRate: 0.03,
    },
  });
}
