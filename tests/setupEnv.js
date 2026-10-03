const path = require('path');

// Runs before any test module is imported. Importing @prisma/client
// auto-loads the ROOT .env (your dev database), and dotenv never
// overrides a variable that's already set — so without this, any test
// file that happened to import Prisma before server/config/env.js
// silently ran against, and wiped, the dev database. Loading .env.test
// here first makes import order irrelevant. Variables exported in the
// shell (e.g. by CI) still win.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.test'), quiet: true });
