const crypto = require('crypto');
const cron = require('node-cron');
const withdrawalService = require('../services/withdrawalService');
const { withAdvisoryLock } = require('../utils/advisoryLock');
const logger = require('../utils/logger');
const errorTracking = require('../utils/errorTracking');
const { runWithContext } = require('../utils/requestContext');

const CONFIRM_LOCK_KEY = 727003;
const FLOAT_LOCK_KEY = 727004;
// Both jobs call Paystack while holding their lock.
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

function scheduled(name, schedule, lockKey, fn) {
  cron.schedule(schedule, () =>
    runWithContext({ job: name, tickId: crypto.randomUUID() }, async () => {
      try {
        await withAdvisoryLock(lockKey, () => fn(), { timeout: LOCK_TIMEOUT_MS });
      } catch (err) {
        logger.error({ err, event: 'sweep_failed' }, `${name} failed`);
        errorTracking.captureException(err);
      }
    })
  );
}

// Every 10 minutes: settle transfers whose webhook never arrived
// (TASK-021). Hourly: alert if Paystack can't cover what users are owed
// (TASK-024). Both are no-ops outside PRODUCTION.
function startPayoutSweep() {
  scheduled('confirmStuckTransfers', '*/10 * * * *', CONFIRM_LOCK_KEY, () => withdrawalService.confirmStuckTransfers());
  scheduled('payoutFloatCheck', '17 * * * *', FLOAT_LOCK_KEY, () => withdrawalService.checkPayoutFloat());
}

module.exports = startPayoutSweep;
