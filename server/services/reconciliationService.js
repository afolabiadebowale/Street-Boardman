const prisma = require('../config/db');
const walletService = require('./walletService');
const logger = require('../utils/logger');
const errorTracking = require('../utils/errorTracking');
const settlementService = require('./settlementService');

// Checks every wallet's stored balance against what the ledger derives
// (TASK-018's per-wallet check, run across all of them). This is the
// "ledger vs wallet" half of TASK-020's reconciliation; the "vs provider
// settlement" half is settlementService (yesterday's Paystack charges and
// transfers against our deposits and withdrawals).
async function reconcileAllWallets() {
  const wallets = await prisma.wallet.findMany({ select: { id: true } });
  const results = await Promise.all(wallets.map((w) => walletService.reconcileWallet(prisma, w.id)));
  const mismatches = results.filter((r) => !r.matches);
  return {
    totalWallets: results.length,
    mismatches,
    allMatch: mismatches.length === 0,
  };
}

// Runs the full daily check and logs a structured pass/fail report. No
// alert routing exists yet (report §9, FEAT-030/TASK-043) — this is the
// same "log loudly so an operator watching logs notices" pattern used by
// TASK-005's payout retry exhaustion, until real alerting is wired up.
async function runDailyReconciliation() {
  const [walletReport, settlement] = await Promise.all([
    reconcileAllWallets(),
    settlementService.reconcileSettlement(),
  ]);

  const report = {
    event: 'daily_reconciliation',
    ranAt: new Date().toISOString(),
    wallets: {
      total: walletReport.totalWallets,
      mismatched: walletReport.mismatches.length,
    },
    providerSettlement: settlement,
    // Skipped (DEMO) is not a failure; a mismatch or an unreachable
    // Paystack is.
    pass: walletReport.allMatch && ['ok', 'skipped'].includes(settlement.status),
  };

  if (!walletReport.allMatch) {
    logger.error(
      {
        ...report,
        mismatches: walletReport.mismatches.map((m) => ({
          walletId: m.walletId,
          storedBalance: m.storedBalance.toString(),
          ledgerBalance: m.ledgerBalance.toString(),
        })),
      },
      'Daily reconciliation found mismatched wallets'
    );
    errorTracking.captureMessage('Daily reconciliation found mismatched wallets', {
      mismatched: walletReport.mismatches.length,
      walletIds: walletReport.mismatches.map((m) => m.walletId),
    });
  } else if (!report.pass) {
    // settlementService has already raised the alert with the details.
    logger.error(report, 'Daily reconciliation: Paystack settlement check failed');
  } else {
    logger.info(report, 'Daily reconciliation passed');
  }

  return report;
}

module.exports = { reconcileAllWallets, runDailyReconciliation };
