# Database restore drill (TASK-044)

**When:** after the first production deploy, then quarterly, and after any change to backup settings.
**How long:** about an hour, mostly waiting for AWS.
**Goal:** prove a backup can actually be restored, and measure how long it takes. That time is the real recovery time if the database is lost.

The drill restores into a **new, separate** database. It never touches production.

## 1. Restore to a point in time

Pick a recent moment, e.g. 30 minutes ago (UTC):

```bash
ENV=prod
SOURCE=streetboardman-$ENV
TARGET=streetboardman-$ENV-drill-$(date +%Y%m%d)
WHEN=$(date -u -d '30 minutes ago' +%Y-%m-%dT%H:%M:%SZ)   # macOS: date -u -v-30M +%Y-%m-%dT%H:%M:%SZ

aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier "$SOURCE" \
  --target-db-instance-identifier "$TARGET" \
  --restore-time "$WHEN" \
  --db-subnet-group-name "$SOURCE" \
  --vpc-security-group-ids <db security group id> \
  --no-publicly-accessible \
  --no-multi-az

date -u   # note the start time
aws rds wait db-instance-available --db-instance-identifier "$TARGET"
date -u   # note the end time: this is your restore time
```

## 2. Check the restored data is real and consistent

Run a one-off task against the drill database. Use the migrate task definition, with `DATABASE_URL` overridden to point at the drill endpoint (same owner password):

```bash
DRILL_HOST=$(aws rds describe-db-instances --db-instance-identifier "$TARGET" --query 'DBInstances[0].Endpoint.Address' --output text)
```

Inside that task, run:

```bash
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const [users, bets, wallets] = await Promise.all([p.user.count(), p.bet.count(), p.wallet.findMany()]);
  const latest = await p.bet.findFirst({ orderBy: { placedAt: 'desc' }, select: { placedAt: true } });
  console.log({ users, bets, wallets: wallets.length, latestBet: latest && latest.placedAt });
  await p.\$disconnect();
})();"
```

Pass criteria:
- [ ] Row counts are close to production's at `$WHEN`.
- [ ] The latest bet is just before `$WHEN`, not hours or days earlier.
- [ ] Wallet balances reconcile with the ledger. Run the reconciliation from `docs/LOAD_TESTING.md` ("After a run") against the drill database: **0 mismatches**.

## 3. Delete the drill database

```bash
aws rds delete-db-instance --db-instance-identifier "$TARGET" --skip-final-snapshot --delete-automated-backups
```

## 4. Record it

| Date | Restored to | Restore time | Rows OK | Reconciled | By |
|---|---|---|---|---|---|
| | | | | | |

If the restore time is too long for the business, options are a larger instance class (faster restores) or a warm Multi-AZ standby (`db_multi_az = true`, failover in about a minute).

## In a real incident

Same steps 1–2, then point the app at the restored database:
1. Update the `database-url-owner`, `database-url-app` (and `db-app-password` if changed) secrets with the new host.
2. Run a deploy. The migrate step re-provisions the app role, and the services restart with the new secrets.
3. Once the restored database is confirmed good, rename the instances or import the new one into Terraform state (`terraform import aws_db_instance.main <id>`).
