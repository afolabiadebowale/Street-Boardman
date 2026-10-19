const { test, expect } = require('@playwright/test');
const { loginAs, SEED_ACCOUNTS } = require('./fixtures');

// Main Boardman journey: log in (seeded Boardman is pre-approved, so no
// approval wait) and create a competition. A timestamped title avoids
// colliding with whatever a previous run left in the database.
test('Boardman logs in and creates a competition', async ({ page }) => {
  await loginAs(page, SEED_ACCOUNTS.boardman);
  await expect(page).toHaveURL(/\/boardman$/);

  await page.getByRole('link', { name: 'Create', exact: true }).click();

  const title = `E2E Match ${Date.now()}`;
  await page.getByPlaceholder('e.g. Tunde vs Seyi', { exact: true }).fill(title);
  await page.getByPlaceholder('e.g. Tunde', { exact: true }).fill('Alpha');
  await page.getByPlaceholder('e.g. Seyi', { exact: true }).fill('Bravo');
  await page.getByRole('button', { name: 'Create Competition' }).click();

  await expect(page).toHaveURL(/\/boardman\/active$/);
  await expect(page.getByText(title)).toBeVisible();
});
