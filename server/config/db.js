// env first: it decides between .env and .env.test, and dotenv never
// overrides an already-set variable.
const env = require('./env');
const { createPrismaClient } = require('../utils/prismaClient');

// One Prisma client for the whole process. Creating a new one per request
// would exhaust Postgres connections.
//
// Connects as the least-privilege runtime role (APP_DATABASE_URL), not
// the migrator/owner role in DATABASE_URL (TASK-034) — this is the
// connection every request and background job actually runs through, so
// it's the one that should never be able to run DDL.
// Falls back to DATABASE_URL straight from process.env when
// appDatabaseUrl isn't set — keeps this working against a partial env
// mock (see tests/unit/depositService.test.js), not just a fully-populated
// one. The adapter connects lazily, so constructing it never touches the
// database.
const prisma = createPrismaClient(env.appDatabaseUrl || process.env.DATABASE_URL);

module.exports = prisma;
