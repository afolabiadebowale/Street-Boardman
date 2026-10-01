const path = require('path');
const { execFileSync } = require('child_process');
const { PostgreSqlContainer } = require('@testcontainers/postgresql');

// `npm run test:hermetic` (TASK-045): the suite gets its own throwaway
// Postgres in Docker — migrated from scratch and provisioned with the
// least-privilege role — instead of a hand-configured test database. No
// local setup beyond Docker, and nothing it does can reach any other
// database. Variables set here are inherited by the test environment and
// take precedence over .env.test (dotenv never overrides).
const APP_ROLE_PASSWORD = 'hermetic_app_pw';

module.exports = async () => {
  const container = await new PostgreSqlContainer('postgres:16')
    .withDatabase('streetboardman_test')
    .withUsername('postgres')
    .withPassword('postgres')
    .withCopyFilesToContainer([{ source: path.resolve(__dirname, '../../prisma/roles.sql'), target: '/tmp/roles.sql' }])
    .start();

  const ownerUrl = `${container.getConnectionUri()}?schema=public`;
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  execFileSync(npx, ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: ownerUrl },
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });

  const roles = await container.exec([
    'psql', '-U', 'postgres', '-d', 'streetboardman_test', '-v', 'ON_ERROR_STOP=1',
    '-v', `app_password=${APP_ROLE_PASSWORD}`, '-f', '/tmp/roles.sql',
  ]);
  if (roles.exitCode !== 0) throw new Error(`roles.sql failed:\n${roles.output}`);

  process.env.DATABASE_URL = ownerUrl;
  process.env.APP_DATABASE_URL = ownerUrl.replace('postgres:postgres@', `streetboardman_app:${APP_ROLE_PASSWORD}@`);
  globalThis.__HERMETIC_PG__ = container;
};
