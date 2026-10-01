# Testing Guide

StreetBoardman has two kinds of automated tests:

- **Unit tests** (`tests/unit/`) — pure functions, no database. Right now
  this is `commissionService`, the exact math from the spec's worked
  example. Run any time with `npm run test:unit` — nothing to set up.
- **Integration tests** (`tests/integration/`) — real HTTP requests
  (via supertest) against the real Express app, backed by a real
  PostgreSQL database. These need Postgres installed and configured, which
  is what the rest of this doc walks through.

`tests/helpers/reset.js` wipes every table before each test file runs.
**Never point the test database at your development or production data.**

---

## 1. Install PostgreSQL on Windows

Chocolatey is already on this machine, which is the fastest path — but
installing a Windows service needs an elevated shell, which an automated
tool can't grant itself. Run this yourself:

1. Open the **Start Menu**, search for **PowerShell**, right-click it, and
   choose **Run as administrator**.
2. Run:
   ```powershell
   choco install postgresql16 --params '/Password:postgres' -y
   ```
   This installs PostgreSQL 16, starts it as a Windows service, and sets
   the `postgres` superuser password to `postgres` (matching the default
   `DATABASE_URL` already in `.env.example` — change it here and in your
   `.env` files together if you'd rather use a different password).
3. Close that elevated window once it finishes. You do **not** need to run
   anything else as administrator after this step.

**Alternative**, if you'd rather not use Chocolatey: download the
installer from https://www.postgresql.org/download/windows/, run it, and
set the superuser password to `postgres` (or your own choice) when
prompted. Either path ends up in the same place: a PostgreSQL server
listening on `localhost:5432`.

## 2. Verify it's running

Back in a normal (non-administrator) terminal:

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -h localhost -c "SELECT version();"
```

It will prompt for the password you set (`postgres` if you used the
command above). If you see a version string back, Postgres is up.

*(Tip: add `C:\Program Files\PostgreSQL\16\bin` to your PATH so you can
just run `psql` instead of the full path — open Settings → System → About
→ Advanced system settings → Environment Variables.)*

## 3. Create two databases

One for everyday development, one disposable one for tests — keeping them
separate means running the test suite can never wipe out data you were
using to click through the app.

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -h localhost -c "CREATE DATABASE streetboardman;"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -h localhost -c "CREATE DATABASE streetboardman_test;"
```

## 4. Configure the app

From the `streetboardman/` folder:

```powershell
copy .env.example .env
copy .env.test.example .env.test
```

Both files already point at `localhost:5432` with user `postgres` /
password `postgres`, database `streetboardman` (dev) and
`streetboardman_test` (test) respectively — matching step 3. Edit them if
you chose a different password or port.

## 5. Run migrations

Migrations only need to be created once (from the schema in
`prisma/schema.prisma`) and then replayed against each database.

```powershell
# Creates the migration files AND applies them to your dev database:
npx prisma migrate dev --name init

# Applies the same migration to the test database:
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/streetboardman_test?schema=public"
npx prisma migrate deploy
Remove-Item Env:\DATABASE_URL
```

(The `$env:DATABASE_URL` / `Remove-Item` lines temporarily override the
connection string just for that one command, without touching your `.env`
files — `migrate deploy` doesn't read `.env.test` automatically the way
the app does.)

## 6. Seed demo data (dev database only — never the test one)

```powershell
npm run seed
```

This creates the demo Better/Boardman/Admin accounts and a sample
competition, as described in the main [README](../README.md).

## 7. Run the tests

```powershell
npm test
```

This runs both unit and integration suites in one process
(`jest --runInBand` — sequential, not parallel, because the integration
tests share one database and reset it between files). Jest sets
`NODE_ENV=test` automatically, which is what makes the app load
`.env.test` instead of `.env` (see `server/config/env.js`) — so it talks
to `streetboardman_test`, never your dev database.

Expect output like:

```
PASS  tests/unit/commissionService.test.js
PASS  tests/integration/auth.test.js
PASS  tests/integration/bettingAndPayout.test.js

Test Suites: 3 passed, 3 total
Tests:       ... passed, ... total
```

## What Each Integration Test File Covers

- **`auth.test.js`** — registration (Better and Boardman), duplicate
  phone rejection, wrong-PIN login rejection, and role permission
  enforcement (a Better can't create a competition, an unapproved
  Boardman can't either, a non-admin can't reach `/admin/*`).
- **`bettingAndPayout.test.js`** — the full spec worked example end to
  end (create competition → two bets split 60/40 → close betting → submit
  result → auto-confirm → payout → verifies the exact ₦3,000/₦1,800
  commission split), plus:
  - payout idempotency (processing the same competition's payout twice
    only pays out once — the second call is a no-op)
  - insufficient-balance rejection
  - deposit idempotency (a repeated Paystack webhook for the same
    reference doesn't double-credit the wallet)

## Troubleshooting

**"Can't reach database server at localhost:5432"**
Postgres isn't running. Check the Windows service: open **Services**
(`services.msc`), find `postgresql-x64-16`, and make sure it's **Running**.

**"password authentication failed for user postgres"**
The password in `DATABASE_URL` doesn't match what you set during install.
Either re-run the install with the password you want, or reset it:
```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -h localhost -c "ALTER USER postgres PASSWORD 'postgres';"
```

**Tests hang or time out**
Usually means Postgres accepted the connection but a query never
returned — check nothing else is holding a long transaction open against
`streetboardman_test` (e.g. a `psql` session you left open mid-transaction).

**"relation does not exist" errors during tests**
The migration wasn't applied to `streetboardman_test`. Re-run step 5's
`prisma migrate deploy` against that database.

**"Refusing to wipe database ..."**
`tests/helpers/reset.js` deletes every row, so it checks the database it's
connected to and refuses anything whose name doesn't contain `test`. If
you see this, `.env.test` is pointing at the wrong database: fix
`DATABASE_URL` / `APP_DATABASE_URL` there. (`tests/setupEnv.js` loads
`.env.test` before any test code, because importing `@prisma/client`
would otherwise pull in your dev `.env` first.)

**"password authentication failed for user streetboardman_app"**
The role's password doesn't match `APP_DATABASE_URL`. Postgres roles are
shared across every database on the server, so if you ran
`prisma/roles.sql` against both your dev and test databases with
different passwords, only the last one is live. Re-run it with one
password and use that same value in both `.env` and `.env.test`.

---

## Hermetic runs (no database setup)

If Docker is running, you can skip all the Postgres setup above:

```bash
npm run test:hermetic
```

This starts a throwaway Postgres 16 container (via Testcontainers),
applies every migration, provisions the `streetboardman_app` role, runs
the whole suite through it, and deletes the container afterwards. It
takes about a minute longer than `npm test`, and it can't touch any other
database on your machine.

## Property-based money tests

`tests/unit/moneyProperties.test.js` and
`tests/integration/moneyConservation.property.test.js` use
[fast-check](https://fast-check.dev). Instead of a few hand-picked
examples, they generate random pools, stakes, commission rates,
outcomes, and concurrent settlements, and check invariants that must
always hold: no naira created or destroyed, the ledger agrees with every
wallet, escrow ends empty, and settling twice pays once. When one fails,
fast-check shrinks it to the smallest failing example and prints it.
Pin that example in the test's `examples` list once it's fixed.

The integration property runs 30 random competitions by default. Run
more before touching payout or refund code:

```bash
PROPERTY_RUNS=300 npx jest tests/integration/moneyConservation.property.test.js
```

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and every push to
`main`. It has two jobs:

- **Server tests**: starts a fresh Postgres 16, applies every migration
  with `prisma migrate deploy`, provisions the `streetboardman_app` role
  from `prisma/roles.sql`, then runs `npm test` through that restricted
  role. A migration that doesn't apply cleanly to an empty database, or
  app code that suddenly needs DDL at runtime, fails the build.
- **Client build**: `npm ci` and `npm run build` in `client/`.

The Node version for both jobs comes from `.nvmrc`.
