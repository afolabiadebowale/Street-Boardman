# StreetBoardman

A digital version of the traditional Nigerian street "Boardman" — a neutral
operator who creates local competitions, accepts bets, records the
official result, and manages payouts and commissions.

Three separate roles, three separate dashboards, one platform:
**Better** (places bets), **Boardman** (runs competitions), **Platform
Admin** (owns and manages the platform).

> **This build runs entirely on DEMO money.** Real-money betting via
> Paystack is wired up but disabled (`APP_MODE=DEMO`) until legal,
> regulatory and payment review is complete — see
> [docs/ENGINEER_MANUAL.md](docs/ENGINEER_MANUAL.md) section 7.

## Documentation

| Doc | Audience | Covers |
|---|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Anyone building on this | Design rationale, roles, DB relationships, state machines, roadmap |
| [docs/BETTER_MANUAL.md](docs/BETTER_MANUAL.md) | Betters | How to register, deposit, bet, withdraw, disputes, FAQ |
| [docs/BOARDMAN_MANUAL.md](docs/BOARDMAN_MANUAL.md) | Boardmen/Operators | Approval, creating competitions, submitting results, commissions |
| [docs/ENGINEER_MANUAL.md](docs/ENGINEER_MANUAL.md) | Developers / app managers | Full architecture, API reference, DB schema, deployment, security checklist, troubleshooting |
| [docs/TESTING.md](docs/TESTING.md) | Developers | PostgreSQL setup on Windows, running the test suite, what each test covers |

## Quick Start (local development)

**Prerequisites**: Node.js 18+, a running PostgreSQL instance.

```bash
# 1. Backend
cp .env.example .env          # then edit DATABASE_URL and secrets
npm install
npx prisma migrate dev --name init
npm run seed                  # creates demo Better/Boardman/Admin accounts
npm run dev                   # http://localhost:4000

# 2. Frontend (separate terminal)
cd client
npm install
npm run dev                   # http://localhost:5173
```

Open http://localhost:5173 and log in with one of the seeded demo accounts
(phone numbers and passwords are in your `.env`, under `SEED_*`).

## Full stack in Docker

Needs only Docker. Runs Postgres, migrations, the API, the worker, and the
client behind nginx, in production mode:

```bash
docker compose up --build                            # http://localhost:8080
docker compose run --rm migrate npx prisma db seed   # optional demo accounts
docker compose down -v                               # stop and wipe the database
```

The server image has three targets (`api`, `worker`, `migrate`); the
client image is nginx serving the built SPA and proxying `/api` to the
API. See the comments in `Dockerfile`, `client/Dockerfile`, and
`docker-compose.yml`.

## Running Tests

```bash
npm run test:unit     # pure-logic tests, no database needed
npm test              # unit + integration (needs PostgreSQL — see below)
```

Integration tests run real HTTP requests against a real Postgres database
and reset all tables before each file — they load `.env.test`, a
**separate database from your everyday dev one**, automatically (Jest sets
`NODE_ENV=test`, which is what triggers the switch — see
`server/config/env.js`).

Full step-by-step PostgreSQL setup for Windows (Chocolatey install,
creating the dev + test databases, running migrations against both) is in
[docs/TESTING.md](docs/TESTING.md).

## Demo Accounts (from `prisma/seed.js`)

| Role | Phone (from `.env`) | Notes |
|---|---|---|
| Better | `SEED_BETTER_PHONE` | Starts with ₦20,000 demo balance |
| Boardman | `SEED_BOARDMAN_PHONE` | Pre-approved, ready to create competitions |
| Admin | `SEED_ADMIN_PHONE` | Full platform access |

A sample competition ("Tunde vs Seyi") is also seeded so there's something
to bet on immediately.

## Project Structure

See [docs/ENGINEER_MANUAL.md](docs/ENGINEER_MANUAL.md) section 2 for the
full annotated folder structure.

## Status

MVP: demo-money betting, wallet ledger, competition lifecycle, dispute
flow, payout/commission engine, and all three dashboards are functional.
Real-money Paystack integration is coded but gated behind `APP_MODE`. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) section 12 for what's still
ahead (PWA icon assets, richer bet option types, production hardening).
