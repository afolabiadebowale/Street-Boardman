// Matches prisma/seed.js exactly — the pre-approved Boardman, the funded
// Better, and the Admin it creates. Falls back to the same defaults
// seed.js uses when the SEED_* env vars aren't set, so this works against
// any environment seeded the normal way (local dev or CI).
const SEED_ACCOUNTS = {
  better: {
    phone: process.env.SEED_BETTER_PHONE || '08022222222',
    pin: process.env.SEED_BETTER_PASSWORD || 'Better@12345',
  },
  boardman: {
    phone: process.env.SEED_BOARDMAN_PHONE || '08011111111',
    pin: process.env.SEED_BOARDMAN_PASSWORD || 'Boardman@123',
  },
  admin: {
    phone: process.env.SEED_ADMIN_PHONE || '08000000000',
    pin: process.env.SEED_ADMIN_PASSWORD || 'Admin@12345',
  },
};

// Seeded accounts never trigger the MFA step (see client/src/routes/auth/Login.jsx) —
// STAFF_SECURITY_ENFORCED_FROM only defaults to enforced when NODE_ENV=production,
// which the e2e webServer never sets — so this is always the plain one-step login.
async function loginAs(page, { phone, pin }) {
  await page.goto('/login');
  await page.getByRole('heading', { name: 'Log In' }).waitFor();
  await page.locator('form input:not([type="password"])').fill(phone);
  await page.locator('form input[type="password"]').fill(pin);
  await page.getByRole('button', { name: 'Log In' }).click();
  // Without this, a caller that does page.goto(...) right after loginAs()
  // (switching users mid-test, e.g. e2e/dispute.spec.js) can race the
  // in-flight /auth/login fetch — the browser aborts it on navigation,
  // so the session cookie never gets set and every call after that one
  // is silently still logged in as the PREVIOUS user. Specs that only
  // assert toHaveURL() right after login never hit this, since that
  // assertion's own polling absorbs the wait.
  await page.waitForURL((url) => url.pathname !== '/login');
}

module.exports = { SEED_ACCOUNTS, loginAs };
