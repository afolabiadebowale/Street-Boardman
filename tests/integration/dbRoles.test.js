const { PrismaClient } = require('@prisma/client');
const env = require('../../server/config/env');

// TASK-034: the whole point of streetboardman_app is that it CANNOT run
// DDL, even though it's exactly what the running server connects as. This
// connects directly as that role (env.appDatabaseUrl — the same
// connection every other integration test already runs its DML through,
// since server/config/db.js uses it too) and proves the boundary is real,
// not just documented in prisma/roles.sql.
// Skips instead of failing when APP_DATABASE_URL isn't set — a fresh
// clone that hasn't run `psql -f prisma/roles.sql` yet shouldn't fail
// `npm test` over an opt-in hardening step; see .env.test.example.
const describeIfConfigured = process.env.APP_DATABASE_URL ? describe : describe.skip;

describeIfConfigured('Least-privilege database role (TASK-034)', () => {
  let appClient;

  beforeAll(() => {
    appClient = new PrismaClient({ datasources: { db: { url: env.appDatabaseUrl } } });
  });

  afterAll(async () => {
    await appClient.$disconnect();
  });

  it('can read and write existing rows (DML)', async () => {
    const before = await appClient.systemSetting.count();
    await appClient.systemSetting.upsert({
      where: { key: 'dbRolesTestProbe' },
      update: { value: 'updated' },
      create: { key: 'dbRolesTestProbe', value: 'created' },
    });
    const after = await appClient.systemSetting.count();
    expect(after).toBeGreaterThanOrEqual(before);
    await appClient.systemSetting.delete({ where: { key: 'dbRolesTestProbe' } });
  });

  it('cannot create a new table (DDL)', async () => {
    await expect(appClient.$executeRawUnsafe('CREATE TABLE dbroles_ddl_probe (id int)')).rejects.toThrow(
      /permission denied/i
    );
  });

  it('cannot alter an existing table (DDL)', async () => {
    // Postgres rejects ALTER/DROP on ownership grounds ("must be owner of
    // table"), a different message than the schema-level "permission
    // denied" CREATE TABLE gets above — both are the same DDL boundary
    // just enforced by a different check, so both count as proof it holds.
    await expect(
      appClient.$executeRawUnsafe('ALTER TABLE "SystemSetting" ADD COLUMN dbroles_probe_col int')
    ).rejects.toThrow(/permission denied|must be owner/i);
  });

  it('cannot drop an existing table (DDL)', async () => {
    await expect(appClient.$executeRawUnsafe('DROP TABLE "SystemSetting"')).rejects.toThrow(
      /permission denied|must be owner/i
    );
  });
});
