const prisma = require('../config/db');
const AppError = require('../utils/appError');
const walletService = require('./walletService');
const { toDecimal } = require('../utils/money');
const { toCsv } = require('../utils/listQuery');

// Monthly account statement (A3): every wallet movement in a calendar
// month, Lagos time, with opening and closing balances, as CSV. Built from
// the same WalletTransaction rows the ledger reconciles against, so the
// opening balance plus the movements always equals the closing balance.
const LAGOS_OFFSET_MS = 60 * 60 * 1000; // WAT is UTC+1 all year (no DST)

function monthBounds(month) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month || '');
  if (!match) throw new AppError('month must look like 2026-10', 422);
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  const start = new Date(Date.UTC(year, index, 1) - LAGOS_OFFSET_MS);
  const end = new Date(Date.UTC(year, index + 1, 1) - LAGOS_OFFSET_MS);
  if (start > new Date()) throw new AppError('That month has not started yet', 422);
  return { start, end };
}

async function monthlyStatement(userId, month) {
  const { start, end } = monthBounds(month);
  const wallet = await walletService.getWalletByUserId(prisma, userId);
  const [movements, before] = await Promise.all([
    prisma.walletTransaction.findMany({
      where: { walletId: wallet.id, createdAt: { gte: start, lt: end } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.walletTransaction.findFirst({
      where: { walletId: wallet.id, createdAt: { lt: start } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }),
  ]);
  const opening = movements.length ? toDecimal(movements[0].balanceBefore) : toDecimal(before ? before.balanceAfter : 0);
  const closing = movements.length ? toDecimal(movements[movements.length - 1].balanceAfter) : opening;

  const rows = [
    { date: start, type: 'OPENING_BALANCE', description: '', amount: '', balance: opening.toFixed(2) },
    ...movements.map((t) => ({
      date: t.createdAt,
      type: t.type,
      description: t.note || '',
      amount: toDecimal(t.amount).toFixed(2),
      balance: toDecimal(t.balanceAfter).toFixed(2),
    })),
    { date: end, type: 'CLOSING_BALANCE', description: '', amount: '', balance: closing.toFixed(2) },
  ];
  const csv = toCsv(rows, [
    ['date', (r) => r.date],
    ['type', (r) => r.type],
    ['description', (r) => r.description],
    ['amount', (r) => r.amount],
    ['balance', (r) => r.balance],
  ]);
  return { csv, opening, closing, movements: movements.length };
}

module.exports = { monthlyStatement, monthBounds };
