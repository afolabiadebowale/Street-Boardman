// Prisma 7 CLI config (migrate, generate, seed). The CLI no longer reads
// the connection URL from schema.prisma or auto-loads .env, so both move
// here. Same file choice as server/config/env.js, so NODE_ENV=test
// migrates the test database; a DATABASE_URL already set in the shell
// (CI, docker compose, the hermetic suite) still wins, since dotenv never
// overrides. process.env rather than prisma's env() keeps `prisma generate`
// working in the Docker build, where no database URL exists.
require('dotenv').config({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });
const { defineConfig } = require('prisma/config');

module.exports = defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed.js',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
