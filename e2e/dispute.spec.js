const { test, expect } = require('@playwright/test');
const { loginAs, SEED_ACCOUNTS } = require('./fixtures');

// The one trust-critical path the other specs don't touch: a Better
// reports a problem with a submitted result (client/src/routes/better/BetTicket.jsx),
// and an Admin resolves it (client/src/routes/admin/Disputes.jsx). Creates
// its own competition so it never collides with data from other spec
// files or previous runs. No auto-confirm sweep can fire mid-test — that
// cron job lives in server/worker.js, which this config never starts.
test('Better disputes a submitted result and Admin resolves it', async ({ page }) => {
  // 1. Boardman creates a fresh competition.
  await loginAs(page, SEED_ACCOUNTS.boardman);
  await page.getByRole('link', { name: 'Create', exact: true }).click();

  const title = `Dispute Test ${Date.now()}`;
  await page.getByPlaceholder('e.g. Tunde vs Seyi', { exact: true }).fill(title);
  await page.getByPlaceholder('e.g. Tunde', { exact: true }).fill('Alpha');
  await page.getByPlaceholder('e.g. Seyi', { exact: true }).fill('Bravo');
  await page.getByRole('button', { name: 'Create Competition' }).click();

  await expect(page).toHaveURL(/\/boardman\/active$/);
  await page.getByText(title).click();
  const competitionUrl = page.url();

  // 2. Better places a bet on "Alpha wins".
  await loginAs(page, SEED_ACCOUNTS.better);
  await page.goto('/better/competitions');
  await page.getByRole('heading', { name: title }).click();
  await page.getByRole('radio', { name: 'Alpha wins' }).check();
  await page.getByPlaceholder('e.g. 5000').fill('500');
  await page.getByRole('button', { name: 'Place Bet' }).click();
  await expect(page).toHaveURL(/\/better\/my-bets\/SB-/);
  const ticketUrl = page.url();

  // 3. Boardman closes betting and submits "Bravo wins" — the Better bet
  // the other way, so there's a real reason to dispute it.
  await loginAs(page, SEED_ACCOUNTS.boardman);
  await page.goto(competitionUrl);
  await page.getByRole('button', { name: 'Close Betting' }).click();
  await page.getByRole('radio', { name: 'Bravo wins' }).check();
  await page.getByRole('button', { name: 'Submit Result' }).click();
  await expect(page.getByText('Result submitted.', { exact: false })).toBeVisible();

  // 4. Better goes back to their ticket and reports a problem.
  await loginAs(page, SEED_ACCOUNTS.better);
  await page.goto(ticketUrl);
  await page.getByRole('heading', { name: 'See a problem with this result?' }).waitFor();
  await page.getByLabel("What's wrong?").fill('Alpha clearly won — this result looks wrong.');
  await page.getByRole('button', { name: 'Report a Problem' }).click();
  await expect(
    page.getByText('Dispute raised. Payouts are frozen until a Platform Admin reviews it.')
  ).toBeVisible();

  // 5. Admin resolves it in the Better's favor.
  await loginAs(page, SEED_ACCOUNTS.admin);
  await page.getByRole('link', { name: 'Disputes' }).click();

  const disputeCard = page.locator('.card', { hasText: title });
  await expect(disputeCard).toContainText('Alpha clearly won — this result looks wrong.');
  await disputeCard.getByRole('button', { name: 'Confirm Result & Pay Out' }).click();

  // Resolved disputes no longer show the resolve buttons (Disputes.jsx only
  // renders them while status is OPEN/UNDER_REVIEW).
  await expect(disputeCard.getByRole('button', { name: 'Confirm Result & Pay Out' })).not.toBeVisible();
});
