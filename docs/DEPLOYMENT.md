# Deploying to AWS

Everything runs in **AWS af-south-1 (Cape Town)**, defined in `infra/terraform/` (TASK-039) and deployed by `.github/workflows/deploy.yml` (TASK-040).

```
                 HTTPS (ACM certificate)
 users ──▶ Application Load Balancer ──┬── /api/*, /health ──▶ API tasks (ECS Fargate)  ─┐
           (optional WAF)              └── everything else ──▶ web tasks (nginx + SPA)    │
                                                                                          ├──▶ RDS Postgres 16
                                           worker task (sweeps, payouts) ─────────────────┤    (private subnets,
                                           migrate task (one-off, per deploy) ────────────┘     TLS required)
 Secrets Manager ──▶ injected into tasks at start    CloudWatch ──▶ alarms ──▶ SNS ──▶ email
```

## What it costs (low-cost sizing)

A rough monthly estimate for one environment at the default sizing. **Check the [AWS Pricing Calculator](https://calculator.aws/) for af-south-1 before committing** (prices change, and Cape Town is pricier than US regions):

| Item | Approx. USD / month |
|---|---|
| Load balancer | 20–25 |
| 3 Fargate tasks (0.25 vCPU, 0.5 GB, always on) | 30–40 |
| RDS db.t4g.micro + 20 GB gp3 | 15–25 |
| KMS key, Secrets Manager (8 secrets), CloudWatch logs and alarms | 8–15 |
| **Total** | **≈ 75–105** |

Turning on high availability (`envs/prod.tfvars`): Multi-AZ database (doubles the database line), a second API and web task (+20), a NAT gateway (+35–45) and WAF (+10). That adds roughly 80–120 more. A single migrate task per deploy costs cents.

Running dev and staging all the time multiplies this. Consider `terraform destroy` on dev when it's idle (deletion protection is off there).

## First-time setup

You need: an AWS account, an admin IAM user or SSO session, a domain, and Terraform ≥ 1.10.

**1. State bucket** (once per AWS account):
```bash
cd infra/bootstrap
terraform init && terraform apply
```
Copy the `state_bucket` output into every `infra/terraform/envs/*.backend.hcl`.

**2. Fill in the environment file**, e.g. `envs/dev.tfvars`: `domain_name`, `route53_zone_id` if your domain is in Route 53, and `alert_emails`.

**3. Plan, read it, then apply:**
```bash
cd infra/terraform
terraform init -backend-config=envs/dev.backend.hcl
terraform plan -var-file=envs/dev.tfvars -out=dev.plan
terraform apply dev.plan
```
Without Route 53, the apply waits on the HTTPS certificate. Add the `acm_validation_records` output at your DNS provider, then point `domain_name` at `load_balancer_dns`.

The services start with the image tag `bootstrap`, which doesn't exist yet. They'll keep retrying until the first deploy in step 5. That's expected.

**4. GitHub Environment.** In the repo, go to Settings → Environments → create `dev` (and later `staging`, `prod`), and add each key from `terraform output github_environment_variables` as an environment **variable**. These are not secrets, and no AWS keys are needed (OIDC). For `prod`, add required reviewers.

**5. First deploy:** Actions → Deploy → Run workflow → `dev`. After this, merges to `main` deploy to dev automatically once CI passes.

**6. Create the first admin.** The seed script refuses to run in production. Run the bootstrap script as a one-off task using the migrate task definition, which holds the owner credentials:
```bash
aws ecs run-task --cluster streetboardman-dev --task-definition streetboardman-dev-migrate \
  --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=[<ECS_SUBNETS>],securityGroups=[<ECS_SECURITY_GROUP>],assignPublicIp=ENABLED}" \
  --overrides '{"containerOverrides":[{"name":"migrate","command":["node","scripts/create-admin.js"],
    "environment":[{"name":"ADMIN_PHONE","value":"080..."},{"name":"ADMIN_NAME","value":"..."},{"name":"ADMIN_PASSWORD","value":"<12+ chars>"}]}]}'
```
Log in at `https://<domain>`. The staff security gate sends you straight to set up MFA.

**7. Confirm the alarm emails.** Each address in `alert_emails` gets an SNS confirmation link.

## Deploys and migrations

The deploy workflow builds images → registers task definitions → **runs migrations and stops there if they fail** → rolls out the API, worker and web, and waits until they're healthy. ECS rolls a deploy back by itself if the new tasks never become healthy.

Old and new code run **side by side for a few minutes** during every rollout, so every migration must work with both:

- **Expand, then contract.** Add a column (nullable, or with a default) in one release and start using it; remove the old column in a *later* release, once nothing reads it.
- **Never rename a column or table in one step.** Add the new one, copy the data, switch the code over, then drop the old one in a later release.
- Big backfills go in their own step, not inside a schema migration.

## Secrets (TASK-033)

All secrets live in Secrets Manager under `streetboardman-<env>/…`, encrypted with the project KMS key, and are injected as environment variables when a task starts. The app code is the same as local development. The API and worker receive only the **restricted** database role; the owner credentials go to the migrate task alone.

**Paystack keys** (needed when switching to `APP_MODE=PRODUCTION`): Terraform creates the slots with random placeholders and never overwrites them afterwards. Paste the real values in, then redeploy:
```bash
aws secretsmanager put-secret-value --secret-id streetboardman-prod/paystack-secret-key --secret-string 'sk_live_...'
aws secretsmanager put-secret-value --secret-id streetboardman-prod/paystack-webhook-secret --secret-string '...'
```

**Rotating a secret.** It's manual on purpose: automatic rotation would sign every user out at random times.
- *JWT secrets:* taint and re-apply, then redeploy. Everyone is signed out and logs in again. Do it at a quiet hour and after any suspected leak.
  `terraform apply -var-file=envs/prod.tfvars -replace='random_password.jwt["access"]'` (and/or `refresh`, `mfa-challenge`)
- *Database passwords:* `-replace='random_password.db_app'` (or `db_owner`). Then **run a deploy**: its migrate step resets the app role's password from the new secret before the services restart.

Terraform state contains these generated values, which is why the state bucket is private, KMS-encrypted and versioned. Limit who can read it.

## Backups (TASK-044)

RDS keeps daily snapshots and allows **point-in-time recovery to any second** within `db_backup_retention_days`: 3 days in dev, 7 in staging, 14 in prod. Prod also keeps a final snapshot if the database is ever deleted, and has deletion protection.

A backup is only proven by restoring it. Run the drill in [`runbooks/RESTORE_DRILL.md`](runbooks/RESTORE_DRILL.md) after the first prod deploy and then quarterly.

## Monitoring (TASK-043)

The CloudWatch dashboard (`terraform output dashboard_url`) and these alarms email `alert_emails`:

| Alarm | Fires when | First thing to check |
|---|---|---|
| PayoutRetriesExhausted | a payout failed 3 times | worker logs for the `competitionId`; winners are waiting |
| ReconciliationMismatch | nightly wallet ≠ ledger | the mismatched `walletId`s in the worker log; treat as an incident |
| WorkerHeartbeatMissing | no sweep ticks for 10 min | worker service events: crashed, or can't reach the DB |
| SweepFailed | sweep errors 3 periods running | worker logs (`event: sweep_failed`) |
| AccountLocked | ≥ 20 lockouts in 15 min | likely credential stuffing; consider `enable_waf` |
| ApiErrors / Api5xx | bursts of unhandled errors | API logs or Sentry, by `requestId` |
| ApiUnhealthy | an API task failing health checks | ECS service events |
| ApiLatencyP95 | p95 > 1 s for 15 min | DB CPU and lock waits (see docs/LOAD_TESTING.md) |
| DbCpu / DbStorage / DbConnections | database under pressure | Performance Insights in the RDS console |

Every log line is JSON with a `requestId` (or `job` and `tickId` for the worker), so a Sentry issue or a user's error reference leads straight to the matching log lines in CloudWatch Logs Insights:
```
fields @timestamp, level, msg, @message | filter requestId = "<id from the error>" | sort @timestamp
```
