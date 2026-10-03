// Standalone worker process (TASK-022): the scheduled sweeps used to start
// inside the API process (server/index.js), which meant every API
// instance ran its own copy of them — fine with exactly one instance, a
// correctness risk the moment there's more than one. This entry point
// runs only the sweeps, with no HTTP server, so it can be deployed and
// scaled independently of the API. The advisory locks in each job
// (server/utils/advisoryLock.js) are what actually stop two replicas of
// *this* process from double-running the same tick.
require('./config/env');
const errorTracking = require('./utils/errorTracking');

errorTracking.initErrorTracking();

const startAutoConfirmSweep = require('./jobs/autoConfirmSweep');
const startReconciliationSweep = require('./jobs/reconciliationSweep');
const startPayoutSweep = require('./jobs/payoutSweep');

const prisma = require('./config/db');
const logger = require('./utils/logger');

logger.info('StreetBoardman worker process starting');
startAutoConfirmSweep();
startReconciliationSweep();
startPayoutSweep();

// Exiting mid-sweep is safe: each sweep runs inside a transaction holding
// its advisory lock, and payouts are idempotent per bet (TASK-006), so an
// interrupted tick just rolls back and the next one resumes it.
async function shutdown(signal) {
  logger.info({ signal }, 'Shutdown signal received, worker exiting');
  await Promise.all([prisma.$disconnect(), errorTracking.flush()]);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
