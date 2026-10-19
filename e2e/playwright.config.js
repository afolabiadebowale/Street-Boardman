const { defineConfig } = require('@playwright/test');

// Two real servers, started the same way a developer runs them locally
// (TASK-047) — NOT `vite preview`, which ignores vite.config.js's dev-only
// `/api` proxy and would 404 every request. Using `vite dev` keeps every
// request the browser makes same-origin (http://localhost:5173), which is
// what server/middleware/sameOrigin.js and the CORS config already expect;
// anything else would need new, never-exercised cross-origin handling.
const API_ENV = {
  NODE_ENV: 'test',
  APP_MODE: 'DEMO',
  PORT: '4000',
  CLIENT_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: process.env.DATABASE_URL,
  APP_DATABASE_URL: process.env.APP_DATABASE_URL || process.env.DATABASE_URL,
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || 'e2e-access-secret',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'e2e-refresh-secret',
  JWT_MFA_CHALLENGE_SECRET: process.env.JWT_MFA_CHALLENGE_SECRET || 'e2e-mfa-challenge-secret',
};

module.exports = defineConfig({
  testDir: '.',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node server/index.js',
      cwd: '..',
      url: 'http://localhost:4000/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: API_ENV,
    },
    {
      command: 'npm run dev',
      cwd: '../client',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
