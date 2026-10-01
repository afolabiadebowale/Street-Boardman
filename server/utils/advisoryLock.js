const prisma = require('../config/db');

// Postgres TRANSACTION-level advisory locks (pg_try_advisory_xact_lock):
// cheap, need no new table or dependency, and release automatically when
// the transaction ends (commit, rollback, or the connection dying) — no
// explicit unlock to forget. Used to make sure that if the worker process
// (TASK-022) is ever scaled to more than one replica, only one of them
// actually runs a given sweep tick — the rest find the lock held and skip
// that tick entirely, rather than doing the same work twice.
//
// This has to run inside prisma.$transaction, not separate $queryRaw
// calls: Prisma's connection pool does not guarantee that two independent
// queries land on the same underlying Postgres session, but a SESSION-level
// lock (pg_try_advisory_lock/pg_advisory_unlock) only means anything if the
// acquire and release are on the same session — otherwise the "unlock"
// silently does nothing and a later call reusing that pooled connection
// can appear to re-acquire a lock that's still actually held elsewhere.
// $transaction pins one connection for its whole duration, which is
// exactly the affinity a transaction-scoped lock needs.
//
// `key` must be a stable 32-bit integer, distinct per job.
async function withAdvisoryLock(key, fn) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(${key}) AS acquired`;
    const acquired = rows[0]?.acquired === true;
    if (!acquired) {
      return { ran: false, reason: 'Another instance is already running this job' };
    }
    const result = await fn(tx);
    return { ran: true, result };
  });
}

module.exports = { withAdvisoryLock };
