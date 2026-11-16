# On-call (TASK-043 follow-up, FEAT-056)

**Who's on call:** one person — there is no rotation and no paid paging
service. Alerts arrive as plain email, via the SNS topic set up in
`infra/terraform/monitoring.tf` (`aws_sns_topic_subscription.email`,
driven by `var.alert_emails`). `infra/terraform/envs/prod.tfvars` still
has `alert_emails = [] # TODO: at least two people` — that's a real,
open gap, not something this doc resolves. Until it's filled in, no
email actually goes anywhere; fill it in before relying on this runbook
in production.

Because this is one person on plain email, there's no 24/7 response
guarantee here. The honest target is: **respond as soon as you see
it**, not within a fixed SLA. If that's not good enough for the
business at some point, the fix is adding a real paging service (e.g.
Opsgenie/PagerDuty on top of the same SNS topic) and a second person —
not pretending one exists today.

## Before you're on call

Make sure you actually have, right now, not "could get":
- AWS console access: CloudWatch (the dashboard from `terraform output
  dashboard_url`, and Logs Insights), ECS service events, RDS.
- Sentry access (client-side errors; `@sentry/react` in `client/`).
- Paystack dashboard access (transfers, webhook delivery logs).
- DB access per `docs/ENGINEER_MANUAL.md` — Prisma Studio or `psql`
  against the real connection string, not a guess.

If any of those is missing, you can see an alarm fire and still be
unable to do anything about it. Fix that before go-live, not during an
incident.

## Severity

Derived from each alarm's own impact description in
`infra/terraform/monitoring.tf` — see `docs/DEPLOYMENT.md` §Monitoring
for the full "fires when" / "first thing to check" table. Not
re-invented here; this just sorts the same alarms by how urgent they
are for a solo responder.

**Sev1 — money or the platform is at risk. Drop what you're doing.**
PayoutRetriesExhausted, ReconciliationMismatch, SweepFailed,
WorkerHeartbeatMissing, ApiUnhealthy, Api5xx, PayoutTransferStuck,
PayoutFloatLow, LostWebhookDeposits, DbStorage, DbConnections.

**Sev2 — degraded or a security signal, not yet acute. Same day.**
AccountLocked, ApiErrors, NotificationGaveUp, SmsSendFailures, DbCpu,
ApiLatencyP95.

AccountLocked is Sev2 by default (likely credential stuffing) but
escalate it to Sev1 the moment you confirm an account was actually
taken over, not just locked.

## Incident flow

1. **Acknowledge** — open the alarm in CloudWatch so you're looking at
   the real metric, not just the email subject line.
2. **Triage** — find the matching entry in `docs/DEPLOYMENT.md`'s
   table for what to check first, then the per-alarm notes below for
   anything that table doesn't cover.
3. **Mitigate** — stop the bleeding (e.g. top up the Paystack float,
   restart the worker service). Mitigating is not the same as fixing
   the root cause; it's fine to mitigate first and investigate after.
4. **Resolve** — fix the actual cause. For anything touching wallet
   balances: **never edit a balance by hand.** Use
   `POST /api/admin/adjustments` (maker-checker, on the ledger, audited)
   per `docs/ENGINEER_MANUAL.md` and `docs/runbooks/FAILURE_DRILLS.md`.
   A `PROCESSING` withdrawal has a transfer in flight at Paystack —
   never edit that by hand either; the webhook or the worker's
   10-minute sweep settles it.
5. **Record** — one row in the incident log below. Even a one-line
   entry beats nothing six months from now when the same alarm fires
   again.

## Per-alarm notes beyond `DEPLOYMENT.md`'s table

Most alarms are covered well enough by that table's "first thing to
check" column. These need a bit more, found while actually running the
first tabletop walkthrough (below):

- **ReconciliationMismatch / SweepFailed / PayoutRetriesExhausted** —
  these are worker log events, not request-scoped, so the generic
  `filter requestId = "<id>"` query in `DEPLOYMENT.md` doesn't find
  them. Use:
  ```
  fields @timestamp, @message | filter event = "daily_reconciliation" | sort @timestamp desc | limit 5
  ```
  (swap the event name for `sweep_failed` / `payout_retries_exhausted`
  as needed). For a reconciliation mismatch specifically, the log line
  carries a `mismatches` array of `{ walletId, storedBalance,
  ledgerBalance }` — that's the exact list to work through with
  `POST /api/admin/adjustments`.
- **ReconciliationMismatch / money-invariant checks in general** — you
  cannot safely run `scripts/verify-money.js` from your laptop against
  production. Run it the same way `docs/runbooks/RESTORE_DRILL.md`
  step 2 runs one-off tasks: as an ECS one-off task with `DATABASE_URL`
  pointed at the real database.
- **LostWebhookDeposits** — reconciliation already auto-credited the
  affected deposits (audited as `DEPOSIT_CREDITED_BY_RECONCILIATION`),
  so nobody is left unpaid when this fires. The work left is fixing
  *why* the webhook didn't arrive: check the webhook URL and
  `PAYSTACK_WEBHOOK_SECRET` in the Paystack dashboard's delivery logs.

## Incident log

| Date | Alarm | Sev | What happened | Fix | By |
|---|---|---|---|---|---|
| | | | | | |

## First tabletop walkthrough — 2026-11-16

Not a live incident — a paper walkthrough of the ReconciliationMismatch
path using this runbook and the real seeded test database, to find
anything missing before calling this "rehearsed." No AWS access was
used; the equivalent local commands are the ones this doc's "mitigate"
step would translate to in production.

```
$ node scripts/verify-money.js
{"ok":true,"failed":[],"violations":{"walletMatchesLedger":0,"noNegativeWallets":0,
"ledgerGroupsBalance":0,"everyBetStakedOnce":0,"winnersPaidOnce":0,"refundsOnce":0,
"optionTotalsMatchBets":0,"settledEscrowEmpty":0,"noStuckPayouts":0},
"counts":{"bets":0,"wallets":3,"completed":0}}

$ node -e "require('./server/services/reconciliationService').runDailyReconciliation().then(r=>console.log(JSON.stringify(r,null,2)))"
{
  "event": "daily_reconciliation",
  "ranAt": "2026-11-16T10:11:46.226Z",
  "wallets": { "total": 3, "mismatched": 0 },
  "providerSettlement": { "status": "skipped", "reason": "DEMO mode: no real money at Paystack to reconcile" },
  "pass": true
}
```

Both passed clean, as expected on a freshly seeded demo database with
no bets. **Finding, fixed:** walking through "find the log line in
CloudWatch" step by step, `DEPLOYMENT.md`'s only documented query
(`filter requestId = "<id>"`) doesn't match this alarm at all — it
assumes a request-scoped error, and this is a worker event with no
`requestId`. That gap is what the event-based query above fixes. Also
confirmed firsthand what the `mismatches` array actually contains
(`walletId`, `storedBalance`, `ledgerBalance`) by reading
`reconciliationService.js`, so the runbook names the real fields
instead of a guess.

**Still open, not fixed here:** `alert_emails` is empty in every
`infra/terraform/envs/*.tfvars` file, so none of this fires anywhere
yet. That's an infra/business decision (whose email(s) go in), not a
docs fix.
