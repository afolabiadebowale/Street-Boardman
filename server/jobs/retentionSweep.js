const crypto = require('crypto');
const cron = require('node-cron');
const privacyService = require('../services/privacyService');
const { withAdvisoryLock } = require('../utils/advisoryLock');
const logger = require('../utils/logger');
const errorTracking = require('../utils/errorTracking');
const { runWithContext } = require('../utils/requestContext');

const LOCK_KEY = 727006;

// Daily at 03:30 (after the 03:00 reconciliation): delete personal data
// past its retention period (FEAT-060, NDPA storage limitation).
function startRetentionSweep() {
  cron.schedule('30 3 * * *', () =>
    runWithContext({ job: 'retentionSweep', tickId: crypto.randomUUID() }, async () => {
      try {
        const { result } = await withAdvisoryLock(LOCK_KEY, () => privacyService.runRetention());
        if (result) logger.info({ event: 'retention_sweep', ...result }, 'Retention sweep done');
      } catch (err) {
        logger.error({ err, event: 'sweep_failed' }, 'retentionSweep failed');
        errorTracking.captureException(err);
      }
    })
  );
}

module.exports = startRetentionSweep;
