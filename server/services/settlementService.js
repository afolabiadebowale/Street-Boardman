const prisma = require('../config/db');
const env = require('../config/env');
const paystack = require('./paystackClient');
const depositService = require('./depositService');
const logger = require('../utils/logger');
const errorTracking = require('../utils/errorTracking');
const { recordAuditLog } = require('../middleware/auditLog');

// Provider-settlement half of the daily reconciliation (TASK-020): our
// records against Paystack's own, for one window (yesterday, by default).
//
// Deposits, matched by reference:
// - charged at Paystack but never credited here (the webhook was lost):
//   credited now through handlePaystackChargeSuccess, the same idempotent,
//   amount-checked path the webhook uses, and audited. Paystack's API is
//   as authoritative as its signed webhook.
// - credited here but not a successful charge at Paystack, or amounts
//   differ: never auto-fixed; reported and alerted, since it means money
//   was credited that may not exist.
// Transfers (payouts), matched by our wd_ reference: any status that
// disagrees is reported and alerted; the payout sweep and webhooks own
// settling transfers.
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

function toKobo(amount) {
  return Math.round(Number(amount) * 100);
}

async function fetchAll(list, from, to) {
  const rows = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data, meta } = await list({ from, to, page, perPage: PAGE_SIZE });
    rows.push(...data);
    if (!meta || page >= (meta.pageCount || 1)) return rows;
  }
  throw new Error(`Paystack returned more than ${MAX_PAGES * PAGE_SIZE} rows for one day`);
}

function yesterdayWindow(now = new Date()) {
  const to = new Date(now);
  to.setUTCHours(0, 0, 0, 0);
  const from = new Date(to.getTime() - 24 * 3600 * 1000);
  return { from, to };
}

async function reconcileDeposits(from, to) {
  const charges = await fetchAll(paystack.listTransactions, from, to);
  const successful = charges.filter((c) => c.status === 'success' && c.currency === 'NGN');
  // Deposits Paystack charged in the window, plus any we marked credited
  // in it, whenever they were created.
  const ours = await prisma.deposit.findMany({
    where: {
      provider: 'PAYSTACK',
      OR: [
        { providerReference: { in: successful.map((c) => c.reference) } },
        { status: 'SUCCESSFUL', verifiedAt: { gte: from, lt: to } },
      ],
    },
  });
  const byRef = new Map(ours.map((d) => [d.providerReference, d]));
  const paystackRefs = new Set(successful.map((c) => c.reference));

  const healed = [];
  const problems = [];
  for (const charge of successful) {
    const deposit = byRef.get(charge.reference);
    if (!deposit) {
      problems.push({ kind: 'charge_without_deposit', reference: charge.reference, amountKobo: charge.amount });
      continue;
    }
    if (toKobo(deposit.amount) !== Number(charge.amount)) {
      problems.push({ kind: 'amount_mismatch', reference: charge.reference, ours: toKobo(deposit.amount), paystack: charge.amount });
      continue;
    }
    if (deposit.status !== 'SUCCESSFUL') {
      await depositService.handlePaystackChargeSuccess(charge.reference, { amount: charge.amount, currency: charge.currency });
      await recordAuditLog({
        action: 'DEPOSIT_CREDITED_BY_RECONCILIATION',
        entityType: 'Deposit',
        entityId: deposit.id,
        beforeState: { status: deposit.status },
        afterState: { status: 'SUCCESSFUL', reason: 'Paystack reports the charge succeeded; webhook was not received' },
      });
      healed.push(charge.reference);
    }
  }
  for (const deposit of ours) {
    const creditedInWindow = deposit.status === 'SUCCESSFUL' && deposit.verifiedAt >= from && deposit.verifiedAt < to;
    if (creditedInWindow && !paystackRefs.has(deposit.providerReference)) {
      problems.push({ kind: 'credited_without_charge', reference: deposit.providerReference, depositId: deposit.id });
    }
  }
  return { checked: successful.length, healed, problems };
}

const OUR_STATUS = { success: 'PROCESSED', failed: 'FAILED', reversed: 'FAILED' };

async function reconcileTransfers(from, to) {
  const transfers = (await fetchAll(paystack.listTransfers, from, to)).filter((t) => String(t.reference || '').startsWith('wd_'));
  const ours = await prisma.withdrawal.findMany({ where: { transferReference: { in: transfers.map((t) => t.reference) } } });
  const byRef = new Map(ours.map((w) => [w.transferReference, w]));
  const problems = [];
  for (const transfer of transfers) {
    const withdrawal = byRef.get(transfer.reference);
    const expected = OUR_STATUS[transfer.status];
    if (!withdrawal) {
      problems.push({ kind: 'transfer_without_withdrawal', reference: transfer.reference });
    } else if (toKobo(withdrawal.amount) !== Number(transfer.amount)) {
      problems.push({ kind: 'amount_mismatch', reference: transfer.reference, ours: toKobo(withdrawal.amount), paystack: transfer.amount });
    } else if (expected && withdrawal.status !== expected && withdrawal.status !== 'PROCESSING') {
      // PROCESSING is in flight; the payout sweep settles it.
      problems.push({ kind: 'status_mismatch', reference: transfer.reference, ours: withdrawal.status, paystack: transfer.status });
    }
  }
  return { checked: transfers.length, problems };
}

async function reconcileSettlement({ now } = {}) {
  if (env.appMode !== 'PRODUCTION' || !env.paystack.secretKey) {
    return { status: 'skipped', reason: 'DEMO mode: no real money at Paystack to reconcile' };
  }
  const { from, to } = yesterdayWindow(now);
  try {
    const [deposits, transfers] = await Promise.all([reconcileDeposits(from, to), reconcileTransfers(from, to)]);
    const problems = [...deposits.problems, ...transfers.problems];
    const report = {
      status: problems.length ? 'mismatch' : 'ok',
      window: { from: from.toISOString(), to: to.toISOString() },
      deposits: { checked: deposits.checked, healed: deposits.healed.length },
      transfers: { checked: transfers.checked },
      problems,
    };
    if (deposits.healed.length) {
      logger.warn({ event: 'settlement_deposits_healed', references: deposits.healed }, 'Credited deposits whose webhook was lost');
    }
    if (problems.length) {
      errorTracking.captureMessage('Paystack settlement does not match our records', { count: problems.length, problems: problems.slice(0, 20) });
    }
    return report;
  } catch (err) {
    errorTracking.captureException(err);
    return { status: 'error', reason: err.message };
  }
}

module.exports = { reconcileSettlement, yesterdayWindow };
