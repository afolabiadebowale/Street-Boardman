const AppError = require('../utils/appError');
const { toDecimal, round2 } = require('../utils/money');
const ledgerService = require('./ledgerService');

// Creates a wallet for a freshly registered user. Every user gets exactly
// one wallet matching their role (Admins don't get a personal wallet here —
// the platform's own commission wallet is a separate seeded record).
async function createWalletForUser(tx, userId, walletType, isDemo) {
  return tx.wallet.create({
    data: { userId, walletType, isDemo, balance: 0 },
  });
}

async function getWalletByUserId(prismaClient, userId) {
  const wallet = await prismaClient.wallet.findUnique({ where: { userId } });
  if (!wallet) throw new AppError('Wallet not found', 404);
  return wallet;
}

async function getPlatformWallet(prismaClient) {
  const wallet = await prismaClient.wallet.findFirst({ where: { walletType: 'PLATFORM' } });
  if (!wallet) throw new AppError('Platform wallet is not set up. Run the seed script.', 500);
  return wallet;
}

// Reads a wallet's balance FROM THE LEDGER rather than trusting the
// Wallet.balance column — the ledger is meant to be the authoritative
// source once TASK-017 has both in sync (TASK-018). A wallet with no
// ledger activity yet (freshly registered, never deposited to) has no
// LedgerAccount — that's correctly a zero balance, not an error.
async function getLedgerDerivedBalance(prismaClient, walletId) {
  const account = await prismaClient.ledgerAccount.findUnique({ where: { walletId } });
  if (!account) return round2(toDecimal(0));
  return ledgerService.getAccountBalance(prismaClient, account.id);
}

// Compares the stored Wallet.balance against what the ledger derives.
// Any mismatch means the two have drifted — a bug, not something this
// function fixes. TASK-020's reconciliation job is the scheduled version
// of this same check, across every wallet.
async function reconcileWallet(prismaClient, walletId) {
  const wallet = await prismaClient.wallet.findUnique({ where: { id: walletId } });
  if (!wallet) throw new AppError('Wallet not found', 404);
  const storedBalance = round2(toDecimal(wallet.balance));
  const ledgerBalance = await getLedgerDerivedBalance(prismaClient, walletId);
  return {
    walletId,
    storedBalance,
    ledgerBalance,
    matches: storedBalance.equals(ledgerBalance),
  };
}

// Resolves a `counterparty` descriptor (see applyWalletTransaction below)
// to the LedgerAccount on the other side of the double entry.
async function resolveCounterpartyAccount(tx, counterparty) {
  if (!counterparty) {
    throw new AppError('applyWalletTransaction requires a counterparty for the ledger entry', 500);
  }
  if (counterparty.type === 'ESCROW') {
    return ledgerService.getOrCreateEscrowAccountForCompetition(tx, counterparty.competitionId);
  }
  if (counterparty.type === 'EXTERNAL') {
    return ledgerService.getExternalAccount(tx);
  }
  if (counterparty.type === 'WALLET') {
    const wallet = await tx.wallet.findUnique({ where: { id: counterparty.walletId } });
    if (!wallet) throw new AppError('Counterparty wallet not found', 404);
    return ledgerService.getOrCreateAccountForWallet(tx, wallet);
  }
  throw new AppError(`Unknown ledger counterparty type: ${counterparty.type}`, 500);
}

// The ONLY place a wallet balance is ever changed. `delta` is signed:
// positive credits the wallet (deposit, win, commission, refund), negative
// debits it (stake, withdrawal). The raw SQL update is conditional on the
// resulting balance staying >= 0, so two concurrent debits can never both
// succeed and push a wallet negative — the loser gets a clean error instead
// of a corrupted balance.
//
// `tx` must be an active Prisma interactive-transaction client, so this
// call is always part of a larger atomic operation (e.g. "deduct stake AND
// create the bet" happen together or not at all).
//
// `counterparty` (TASK-017) says where the OTHER side of this movement
// goes in the double-entry ledger — every call site has to state it
// explicitly rather than the ledger trying to infer it from `type`, since
// e.g. an ADJUSTMENT can mean different things depending on context.
// Shapes: { type: 'ESCROW', competitionId } | { type: 'EXTERNAL' } |
// { type: 'WALLET', walletId }. WalletTransaction (below) keeps being
// written unchanged alongside the ledger — nothing reads from the ledger
// yet (TASK-018 is that migration), this just makes sure it's already
// correct and populated by the time something does.
async function applyWalletTransaction(tx, { walletId, type, delta, referenceType, referenceId, note, counterparty }) {
  const deltaDecimal = round2(toDecimal(delta));

  const rows = await tx.$queryRaw`
    UPDATE "Wallet"
    SET balance = balance + ${deltaDecimal}
    WHERE id = ${walletId} AND balance + ${deltaDecimal} >= 0
    RETURNING balance
  `;

  if (rows.length === 0) {
    throw new AppError('Insufficient wallet balance', 400);
  }

  const balanceAfter = round2(toDecimal(rows[0].balance));
  const balanceBefore = round2(balanceAfter.minus(deltaDecimal));

  const walletTransaction = await tx.walletTransaction.create({
    data: {
      walletId,
      type,
      amount: deltaDecimal,
      balanceBefore,
      balanceAfter,
      referenceType,
      referenceId,
      note,
    },
  });

  // A zero-rate commission (etc.) still writes a WalletTransaction today
  // (unchanged behaviour, e.g. so a 0% competition shows a "₦0 commission"
  // line rather than nothing) — but a zero-amount leg carries no
  // information for the ledger and postLedgerGroup rejects non-positive
  // amounts, so skip it rather than special-casing zero there.
  if (!deltaDecimal.isZero()) {
    const wallet = await tx.wallet.findUnique({ where: { id: walletId } });
    const walletAccount = await ledgerService.getOrCreateAccountForWallet(tx, wallet);
    const counterpartyAccount = await resolveCounterpartyAccount(tx, counterparty);
    const isCredit = deltaDecimal.gte(0);
    const magnitude = deltaDecimal.abs();

    await ledgerService.postLedgerGroup(tx, [
      {
        accountId: walletAccount.id,
        direction: isCredit ? 'CREDIT' : 'DEBIT',
        amount: magnitude,
        referenceType,
        referenceId,
        note,
      },
      {
        accountId: counterpartyAccount.id,
        direction: isCredit ? 'DEBIT' : 'CREDIT',
        amount: magnitude,
        referenceType,
        referenceId,
        note,
      },
    ]);
  }

  return walletTransaction;
}

module.exports = {
  createWalletForUser,
  getWalletByUserId,
  getPlatformWallet,
  applyWalletTransaction,
  getLedgerDerivedBalance,
  reconcileWallet,
};
