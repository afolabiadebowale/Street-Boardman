const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

// Prisma 7 has no built-in query engine: every client talks to Postgres
// through a driver adapter (node-postgres here), and the connection URL is
// passed in rather than read from schema.prisma. One place builds clients
// so the server, seed, scripts and tests can't drift apart.
function createPrismaClient(connectionString) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

module.exports = { createPrismaClient };
