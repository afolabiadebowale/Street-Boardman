const base = require('./jest.config');

module.exports = {
  ...base,
  globalSetup: '<rootDir>/tests/hermetic/globalSetup.js',
  globalTeardown: '<rootDir>/tests/hermetic/globalTeardown.js',
};
