module.exports = {
  // Without this, Jest's default `roots: ['<rootDir>']` scans the whole
  // repo, including client/src/**/*.test.jsx — which Vitest (not Jest)
  // owns and Jest can't parse (no JSX transform configured here). Scoping
  // to tests/ keeps server Jest and client Vitest from ever colliding.
  roots: ['<rootDir>/tests'],
  testEnvironment: 'node',
  testTimeout: 20000,
  setupFiles: ['<rootDir>/tests/setupEnv.js'],
};
