const { test, expect } = require('@playwright/test');
const { loginAs, SEED_ACCOUNTS } = require('./fixtures');

// Main Admin journey: log in and reach the Boardmen list, confirming the
// seeded (pre-approved) "Demo Boardman" is visible there.
test('Admin logs in and views the Boardmen list', async ({ page }) => {
  await loginAs(page, SEED_ACCOUNTS.admin);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText('Platform Overview')).toBeVisible();

  await page.getByRole('link', { name: 'Boardmen' }).click();
  await expect(page.getByText('Demo Boardman')).toBeVisible();
});
