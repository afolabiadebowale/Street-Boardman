// Deliberately the first import: @prisma/client auto-loads the root .env
// (the dev database). Before tests/setupEnv.js existed, importing it first
// is exactly what sent several suites to the dev database.
require('@prisma/client');

const { assertTestDatabase } = require('../helpers/reset');

describe('Tests can never touch the dev database', () => {
  it('points at the test database even when Prisma is imported before app config', () => {
    const env = require('../../server/config/env');
    expect(process.env.DATABASE_URL).toMatch(/test/i);
    expect(env.appDatabaseUrl).toMatch(/test/i);
  });

  it('resetDatabase refuses to wipe a database whose name lacks "test"', () => {
    expect(() => assertTestDatabase('streetboardman')).toThrow(/Refusing to wipe database "streetboardman"/);
    expect(() => assertTestDatabase('streetboardman_test')).not.toThrow();
  });
});
