const crypto = require('crypto');
const cron = require('node-cron');
const competitionService = require('../services/competitionService');
const resultService = require('../services/resultService');
const { withAdvisoryLock } = require('../utils/advisoryLock');
const logger = require('../utils/logger');
const errorTracking = require('../utils/errorTracking');
const { runWithContext } = require('../utils/requestContext');

// Arbitrary, stable — just needs to be distinct from every other job's key.
const LOCK_KEY = 727001;

// Runs every minute:
//  1. Auto-closes betting on any competition whose deadline has passed.
//  2. Auto-confirms any result whose confirmation window has passed
//     without a dispute, and runs the payout engine for it.
//  3. Retries any competition stuck in RESULT_CONFIRMED or
//     PAYOUT_PROCESSING (payout never started, or was interrupted
//     partway through) — TASK-005, builds on TASK-006's resumable,
//     per-bet-chunked payouts.
// This is what makes "no dispute raised -> auto-confirmed" (see docs
// section 10) actually happen without an Admin manually clicking confirm
// on every ordinary competition.
function startAutoConfirmSweep() {
  cron.schedule('* * * * *', () =>
    // Every log line from this tick — including ones deep inside the
    // payout engine — carries the same tickId (TASK-041).
    runWithContext({ job: 'autoConfirmSweep', tickId: crypto.randomUUID() }, async () => {
      try {
        // TASK-022: if this ever runs as more than one worker replica, only
        // one of them does the work for a given tick — the rest skip it
        // rather than racing to auto-confirm/retry the same competitions.
        await withAdvisoryLock(LOCK_KEY, async () => {
          await competitionService.autoCloseExpiredCompetitions();
          await resultService.autoConfirmDueResults();
          await resultService.retryStuckPayouts();
        });
      } catch (err) {
        logger.error({ err, event: 'sweep_failed' }, 'autoConfirmSweep failed');
        errorTracking.captureException(err);
      } finally {
        // Heartbeat: a worker that dies or hangs logs nothing at all, and
        // payouts silently stop. The CloudWatch "worker heartbeat missing"
        // alarm (infra/terraform/monitoring.tf) fires when these stop.
        logger.info({ event: 'sweep_tick' }, 'autoConfirmSweep tick');
      }
    })
  );
}

module.exports = startAutoConfirmSweep;
