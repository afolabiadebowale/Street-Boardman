const crypto = require('crypto');
const cron = require('node-cron');
const reconciliationService = require('../services/reconciliationService');
const { withAdvisoryLock } = require('../utils/advisoryLock');
const logger = require('../utils/logger');
const errorTracking = require('../utils/errorTracking');
const { runWithContext } = require('../utils/requestContext');

const LOCK_KEY = 727002;

// Runs once a day at 03:00 server time — quiet hours, and well clear of
// the every-minute autoConfirmSweep so the two never compete for the same
// rows. Checks every wallet's stored balance against the ledger (TASK-020).
function startReconciliationSweep() {
  cron.schedule('0 3 * * *', () =>
    runWithContext({ job: 'reconciliationSweep', tickId: crypto.randomUUID() }, async () => {
      try {
        // TASK-022: same double-run protection as autoConfirmSweep.
        await withAdvisoryLock(LOCK_KEY, () => reconciliationService.runDailyReconciliation());
      } catch (err) {
        logger.error({ err, event: 'sweep_failed' }, 'reconciliationSweep failed');
        errorTracking.captureException(err);
      }
    })
  );
}

module.exports = startReconciliationSweep;
