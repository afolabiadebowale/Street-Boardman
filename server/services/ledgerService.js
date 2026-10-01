const AppError = require('../utils/appError');
const { toDecimal, round2 } = require('../utils/money');
const crypto = require('crypto');

// Sign convention used throughout: CREDIT increases an account's balance,
// DEBIT decreases it — for every account type, including ESCROW. This
// isn't classic dual-sided (asset vs. liability) accounting, where a
// wallet-as-liability would flip that; it's a deliberate simplification
// since this ledger's job is to guarantee money is conserved, not to
// produce formal financial statements. "Credit their wallet" meaning "give
// them money" matches everyday banking language, which is what the rest
// of this codebase (WalletTransaction, applyWalletTransaction) already
// assumes.

// Returns (creating if necessary) the LedgerAccount backing a given
// Wallet. USER_WALLET for Better/Boardman wallets, PLATFORM for the
// singleton platform wallet.
//
// Both get-or-create helpers insert with ON CONFLICT DO NOTHING, then
// read. They used to be find-then-create: the first concurrent bets on a
// new competition raced to create the same escrow account, and the
// loser's whole bet failed on the unique constraint. (Wallet accounts
// were shielded by the wallet row lock taken first, but get the same
// treatment rather than relying on every caller doing that.) Retrying isn't an option — these run inside interactive
// transactions, which Postgres aborts on the first failed statement — and
// Prisma's upsert with an empty update isn't run as a native ON CONFLICT.
// A concurrent inserter waits on the first one's uncommitted row, then
// does nothing; the follow-up read sees the committed row.
async function getOrCreateAccountForWallet(tx, wallet) {
  const type = wallet.walletType === 'PLATFORM' ? 'PLATFORM' : 'USER_WALLET';
  await tx.$executeRaw`
    INSERT INTO "LedgerAccount" ("id", "type", "walletId")
    VALUES (${crypto.randomUUID()}, ${type}::"LedgerAccountType", ${wallet.id})
    ON CONFLICT ("walletId") DO NOTHING`;
  return tx.ledgerAccount.findUnique({ where: { walletId: wallet.id } });
}

// Returns (creating if necessary) the escrow LedgerAccount for a
// competition. TASK-019 is what actually routes stakes/payouts through
// it — this just guarantees the account exists on demand.
async function getOrCreateEscrowAccountForCompetition(tx, competitionId) {
  await tx.$executeRaw`
    INSERT INTO "LedgerAccount" ("id", "type", "competitionId")
    VALUES (${crypto.randomUUID()}, 'ESCROW'::"LedgerAccountType", ${competitionId})
    ON CONFLICT ("competitionId") DO NOTHING`;
  return tx.ledgerAccount.findUnique({ where: { competitionId } });
}

// The singleton counterparty for money entering or leaving the system
// entirely (deposits, withdrawals) — the ledger's "outside world" account.
// Unlike the other resolvers this is find-only: it's seeded once by a
// migration (a fixed id, 'ledger-external-account', so it can't be
// duplicated by a race the way an on-demand get-or-create could — there's
// no unique constraint available for "at most one row with no walletId
// and no competitionId"). Mirrors how getPlatformWallet already works.
async function getExternalAccount(tx) {
  const account = await tx.ledgerAccount.findUnique({ where: { id: 'ledger-external-account' } });
  if (!account) {
    throw new AppError('Ledger external account is not set up — check migrations have run', 500);
  }
  return account;
}

// The ONLY way ledger entries are ever written. Takes a flat list of legs
// — each { accountId, direction: 'DEBIT'|'CREDIT', amount, referenceType,
// referenceId, note? } — and refuses to write ANY of them unless the
// debits and credits sum to exactly the same amount. This is the
// invariant TASK-016 exists to guarantee: the ledger can never record an
// economic event that creates or destroys money. Postgres has no
// straightforward way to check a property across a dynamic set of sibling
// rows, so this application-level check is what enforces it — always call
// it from inside a transaction so a bug elsewhere can't write a partial,
// unbalanced group.
async function postLedgerGroup(tx, legs) {
  if (!legs || legs.length < 2) {
    throw new AppError('A ledger group needs at least one debit and one credit leg', 500);
  }

  let debitTotal = toDecimal(0);
  let creditTotal = toDecimal(0);
  for (const leg of legs) {
    const amount = round2(toDecimal(leg.amount));
    if (amount.lte(0)) {
      throw new AppError('Ledger entry amounts must be positive — direction carries the sign', 500);
    }
    if (leg.direction === 'DEBIT') {
      debitTotal = debitTotal.plus(amount);
    } else if (leg.direction === 'CREDIT') {
      creditTotal = creditTotal.plus(amount);
    } else {
      throw new AppError(`Invalid ledger entry direction: ${leg.direction}`, 500);
    }
  }
  if (!debitTotal.equals(creditTotal)) {
    throw new AppError(
      `Ledger group does not balance: debits ${debitTotal.toString()} != credits ${creditTotal.toString()}`,
      500
    );
  }

  const groupId = crypto.randomUUID();
  await tx.ledgerEntry.createMany({
    data: legs.map((leg) => ({
      groupId,
      accountId: leg.accountId,
      direction: leg.direction,
      amount: round2(toDecimal(leg.amount)),
      referenceType: leg.referenceType,
      referenceId: leg.referenceId,
      note: leg.note || null,
    })),
  });

  return { groupId };
}

// Derives an account's current balance by summing its entries. This is
// what TASK-018 uses to make Wallet.balance a read of the ledger instead
// of its own separately-written column.
async function getAccountBalance(tx, accountId) {
  const entries = await tx.ledgerEntry.findMany({ where: { accountId } });
  const total = entries.reduce((sum, entry) => {
    const amount = toDecimal(entry.amount);
    return entry.direction === 'CREDIT' ? sum.plus(amount) : sum.minus(amount);
  }, toDecimal(0));
  return round2(total);
}

module.exports = {
  getOrCreateAccountForWallet,
  getOrCreateEscrowAccountForCompetition,
  getExternalAccount,
  postLedgerGroup,
  getAccountBalance,
};
