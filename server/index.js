// Scheduled sweeps (auto-confirm, payout retry, reconciliation) run in the
// separate worker process (server/worker.js), not here — see TASK-022.
//
// Order matters: env loads .env (where SENTRY_DSN may live), and error
// tracking must initialise before Express is required so the SDK can
// instrument it.
const env = require('./config/env');
const errorTracking = require('./utils/errorTracking');

errorTracking.initErrorTracking();

const app = require('./app');
const prisma = require('./config/db');
const logger = require('./utils/logger');

const server = app.listen(env.port, () => {
  logger.info({ port: env.port, appMode: env.appMode }, 'StreetBoardman API listening');
});

// Node as a container's PID 1 ignores SIGTERM unless handled, so without
// this every deploy waits out the stop timeout and gets SIGKILLed with
// requests still in flight. Stop accepting connections, let in-flight
// requests finish, then release DB connections.
function shutdown(signal) {
  logger.info({ signal }, 'Shutdown signal received, draining connections');
  server.close(async () => {
    await Promise.all([prisma.$disconnect(), errorTracking.flush()]);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
