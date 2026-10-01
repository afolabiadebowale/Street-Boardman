# Load Testing (TASK-048)

Two [k6](https://k6.io) scenarios live in `loadtest/`:

| Script | Simulates |
|---|---|
| `hot-competition.js` | Hundreds of bettors betting on one popular match at once. Every bet updates the same two option rows, so this exercises the system's main contention point. |
| `mass-payout.js` | One competition with many bets settling through the real worker, while other users keep browsing and betting. |

## Running them

Needs only Docker. k6 runs in a container on the compose network:

```bash
docker compose up -d --build
docker compose run --rm migrate npx prisma db seed     # the scripts log in as the seeded admin

docker compose run --rm k6 run /scripts/hot-competition.js
docker compose run --rm k6 run /scripts/mass-payout.js
```

Tune with `-e`, e.g. `docker compose run --rm -e BETTORS=500 -e HOLD=5m k6 run /scripts/hot-competition.js`.

| Variable | Default | Script |
|---|---|---|
| `BETTORS` | 200 / 300 | both |
| `HOLD` | `3m` | hot-competition: time at full load |
| `BETS_EACH` | 3 | mass-payout: bets per bettor on the settling match |
| `BACKGROUND_USERS` | 50 | mass-payout: users active during the payout |
| `RUN_TAG` | random | 3 digits that keep phone numbers unique across runs on the same database |

Full JSON summaries are written to `loadtest/results/` (gitignored).

**After a run**, check the money is still right:

```bash
docker compose exec api node -e "require('./server/services/reconciliationService').reconcileAllWallets().then(r => console.log(r.totalWallets, 'wallets,', r.mismatches.length, 'mismatches'))"
```

### How the tests stay realistic

- **Per-user IPs.** The API limits logins (20 per 15 min) and bets (30 per min) per client IP. If every simulated user came from the k6 container's single IP, the test would only measure the rate limiter. So k6 talks to the API directly, and each simulated user sends its own `X-Forwarded-For`. `TRUST_PROXY_HOPS=1` makes the API treat that as the client IP, which keeps the real limits per user.
- **Real production paths.** The stack runs with `NODE_ENV=production`, the least-privilege DB role, and structured logging on. The mass payout settles through the worker's auto-confirm sweep (the confirmation window is set to 0 for the run and restored afterwards), not a shortcut.
- **Realistic pacing.** Each bettor bets every 2–4 s (about 20 a minute), under the per-IP limit.

## Baseline

**Environment:** a single laptop: Intel i7-9850H (12 logical CPUs), 32 GB RAM, Docker Desktop on Windows 11 with 12 CPUs / 16 GB for Docker, one API and one worker container, Postgres 16 in a container. All components share the machine, k6 included. Treat these numbers as a **relative baseline** for spotting regressions, not a production capacity figure. Back-to-back runs on this machine varied by roughly ±20%. Re-baseline on the real AWS environment (TASK-039).

### Hot competition: 200 concurrent bettors, 3 min at full load

| | First run | After fixes |
|---|---|---|
| Bets placed | 8,031 (28/s) | 13,716 (44.6/s) |
| **Bets failed** | **6,289 (44%)** | **0** |
| `place_bet` p50 / p95 / p99 | 62 / 221 / 408 ms | 79 / **678** / 1,527 ms |
| View competition p95 | 40 ms | 163 ms |
| Thresholds (p95 < 800 ms, p99 < 2 s, errors < 1%) | failed | **passed** |

The first run's latency looked better only because 44% of bets failed instantly. Fixes made because of this test:

1. **Bet codes collided under concurrency** (`count(bets) + 1`), causing a 500 on 44% of bets. They now come from a Postgres sequence.
2. **Escrow ledger account creation raced** on a new competition's first bets. It's now atomic (`INSERT … ON CONFLICT`).
3. **Lock contention on the two option rows.** Postgres sessions were almost all waiting on `Lock:transactionid`. The option-total update was moved to the end of the transaction, so the hot row is locked for one round trip instead of three: p95 went from 932 → 678 ms at the same load.

Throughput (≈44 bets/s) is set by what 200 users at 20 bets a minute offer, not by a ceiling. Raise `BETTORS` to find the knee.

### Mass payout: 900 bets from 300 bettors, 50 users active meanwhile

| | |
|---|---|
| Waiting for the worker sweep | 55 s (sweep runs once a minute, so 0–60 s) |
| **Payout processing** | **13.5 s** (~67 bets/s, one transaction per winning bet) |
| Result submitted → everyone paid | 69 s |
| Background reads p95 | 36 ms |
| Background bets p95 / p99 | 129 / 1,909 ms |

**Money integrity after all runs:** about 53,000 bets and 2 payouts across 1,390 wallets. Every wallet reconciles with the double-entry ledger and none is negative. (The one mismatch found was the seed script writing the demo bettor's balance without a ledger entry, which is now fixed.)

## What to watch next

- **The p99 spike during a payout** (1.9 s for background bets) shows that payout writes compete with live betting. Look at this first if payout sizes grow: batch winners per transaction, or run payouts at a lower Postgres priority.
- **Sweep latency** dominates time-to-paid (up to 60 s). If that matters for the product, trigger the payout on confirmation instead of waiting for the next tick.
- **Single hot rows.** Per-option totals are still one row each. If p95 climbs with more bettors per match, move to append-only stake rows summed on read, or sharded counters.
- **Betting-closed race.** `placeBet` checks the competition is open before its transaction, so a bet can land just after betting closes. It's low-probability, but worth closing by re-checking inside the transaction.
- **Rate-limit store.** In-memory per process (see ASVS review O5). With more than one API instance, each instance has its own counters.
