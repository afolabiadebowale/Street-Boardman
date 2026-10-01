// Node equivalent of prisma/roles.sql, for environments without psql —
// the ECS migrate task runs this right after `prisma migrate deploy`
// (TASK-034/039). Uses the owner connection in DATABASE_URL; sets the
// least-privilege role's password from APP_DB_PASSWORD. Safe to re-run.
const { PrismaClient } = require('@prisma/client');

async function provisionDbRoles(prisma, appPassword) {
  if (!appPassword) throw new Error('APP_DB_PASSWORD is required');

  // format('%L') makes Postgres quote the password itself — no string
  // building with the secret on this side.
  const exists = await prisma.$queryRaw`SELECT 1 FROM pg_roles WHERE rolname = 'streetboardman_app'`;
  const verb = exists.length ? 'ALTER ROLE streetboardman_app WITH' : 'CREATE ROLE streetboardman_app';
  const [{ sql }] = await prisma.$queryRawUnsafe(`SELECT format('${verb} LOGIN PASSWORD %L', $1::text) AS sql`, appPassword);
  await prisma.$executeRawUnsafe(sql);

  const statements = [
    `DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO streetboardman_app', current_database()); END $$`,
    'REVOKE CREATE ON SCHEMA public FROM PUBLIC',
    'GRANT USAGE ON SCHEMA public TO streetboardman_app',
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO streetboardman_app',
    'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO streetboardman_app',
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO streetboardman_app',
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO streetboardman_app',
  ];
  for (const statement of statements) {
    // eslint-disable-next-line no-await-in-loop
    await prisma.$executeRawUnsafe(statement);
  }
}

module.exports = { provisionDbRoles };

if (require.main === module) {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  provisionDbRoles(prisma, process.env.APP_DB_PASSWORD)
    .then(() => console.log('streetboardman_app role provisioned'))
    .catch((err) => {
      console.error('Failed to provision database roles:', err.message);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
