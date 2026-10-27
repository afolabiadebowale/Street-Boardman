const crypto = require('crypto');
const cron = require('node-cron');
const privacyService = require('../services/privacyService');
const uploadService = require('../services/uploadService');
const { withAdvisoryLock } = require('../utils/advisoryLock');
const logger = require('../utils/logger');
const errorTracking = require('../utils/errorTracking');
const { runWithContext } = require('../utils/requestContext');

const LOCK_KEY = 727006;

// Daily at 03:30 (after the 03:00 reconciliation): delete personal data
// past its retention period (FEAT-060, NDPA storage limitation) and
// evidence photos never attached to a result within a week (A5).
function startRetentionSweep() {
  cron.schedule('30 3 * * *', () =>
    runWithContext({ job: 'retentionSweep', tickId: crypto.randomUUID() }, async () => {
      try {
        // Retention (FEAT-060) and abandoned evidence photos (A5).
        const { result } = await withAdvisoryLock(
          LOCK_KEY,
          async () => ({ ...(await privacyService.runRetention()), ...(await uploadService.purgeAbandoned()) }),
          { timeout: 5 * 60 * 1000 } // file deletes happen while the lock is held
        );
        if (result) logger.info({ event: 'retention_sweep', ...result }, 'Retention sweep done');
      } catch (err) {
        logger.error({ err, event: 'sweep_failed' }, 'retentionSweep failed');
        errorTracking.captureException(err);
      }
    })
  );
}

module.exports = startRetentionSweep;
