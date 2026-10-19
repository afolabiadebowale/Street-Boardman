const { test, expect } = require('@playwright/test');
const { loginAs, SEED_ACCOUNTS } = require('./fixtures');

// Main Better journey: log in, browse to the seeded competition, place a
// bet, and land on a real digital ticket. Uses the "Tunde vs Seyi"
// competition prisma/seed.js creates with bettingDeadline = now + 24h at
// seed time, so it's always open whenever this runs.
test('Better logs in, places a bet, and sees the ticket', async ({ page }) => {
  await loginAs(page, SEED_ACCOUNTS.better);
  await expect(page).toHaveURL(/\/better$/);

  await page.getByRole('link', { name: 'Bet', exact: true }).click();
  await page.getByRole('heading', { name: 'Tunde vs Seyi' }).click();

  await page.getByRole('radio', { name: 'Tunde wins' }).check();
  await page.getByPlaceholder('e.g. 5000').fill('500');
  await page.getByRole('button', { name: 'Place Bet' }).click();

  await expect(page).toHaveURL(/\/better\/my-bets\/SB-/);
  await expect(page.getByText('Bet Ticket')).toBeVisible();
  await expect(page.locator('.ticket-row', { hasText: 'Status' })).toContainText('OPEN');
});
