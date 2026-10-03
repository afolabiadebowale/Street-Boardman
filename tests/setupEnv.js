const path = require('path');

// Runs before any test module is imported. Anything that loads the ROOT
// .env first (your dev database) wins, because dotenv never overrides a
// variable that's already set. Prisma 5 did exactly that on import, and
// several suites ran against, and wiped, the dev database. Prisma 7 no
// longer does, but a stray require('dotenv').config() would; loading
// .env.test here first makes import order irrelevant. Variables exported
// in the shell (e.g. by CI) still win.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.test') });
