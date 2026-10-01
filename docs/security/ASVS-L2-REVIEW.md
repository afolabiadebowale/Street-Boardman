# Internal OWASP ASVS Level 2 Review (TASK-036)

**Date:** 2026-09-30 · **Scope:** `server/`, `client/src/`, `prisma/`, CI and Docker config on `feat/a-phase1-foundation` · **Standard:** OWASP ASVS 4.0.3, Level 2

This is an internal review done by reading the code and exercising it with tests, not a penetration test or a formal third-party audit. It should be repeated before real money goes live, and a third-party test is still recommended at that point.

## Summary

| | Count |
|---|---|
| Issues found and **fixed** in this review | 10 |
| Money bugs found by the property tests just before this review (TASK-045), fixed | 2 |
| Open items since resolved (O1–O3, the P1s) | 3 |
| **Open** items needing a decision or later work | 7 |

The most serious finding was **F0**: admin list screens sent other accounts' PIN hashes and MFA secrets to any staff member. Next came **logins and sessions**. A 4-digit PIN had no per-account guessing limit. Logging out didn't actually end a session, and a session could be refreshed forever without logging in again. All three are fixed.

The three P1 items have since been fixed: mandatory staff MFA, 12-character staff passwords, and PIN confirmation for withdrawals. What remains is a product decision (bettor PIN length) and **scaling work** needed before running more than one API instance (shared rate-limit store, TASK-033 secrets).

## Fixed in this review

Every fix has tests; files are in `tests/integration/` unless noted.

| # | ASVS | Issue | Fix | Tests |
|---|---|---|---|---|
| F0 | 8.3.1 / 4.2 | **Admin endpoints leaked credentials.** User lists, both Boardman lists, competitions, the ledger, and the suspend/reactivate/approve/staff-role responses returned whole `User` rows, including PIN hashes and TOTP secrets. Any staff member with view access (e.g. SUPPORT) could generate a SUPER_ADMIN's MFA codes and attack their PIN offline, a direct path to full admin takeover. | One allow-list of staff-visible user fields (`server/utils/userSelect.js`), used by every admin query. New `User` columns stay private unless deliberately added to it. | `adminDataExposure` (finds admin GET routes automatically; fails on the old code at 6 endpoints) |
| F1 | 2.2.1 | Guessing was limited **per IP only**. A 4-digit PIN is 10,000 guesses, and an attacker spreading them across many IPs was never stopped. | Per-account lockout: 5 wrong PINs **or MFA codes** lock the account for 15 minutes (≈20 guesses/hour max). The lock is checked before the PIN is compared, concurrent guesses are counted atomically, and unknown phone numbers cost the same bcrypt time. Locks are logged as `account_locked` for alerting. | `authLockout`, `mfaLockout` |
| F2 | 3.3.1 | **Logout didn't end the session.** It only cleared cookies; a copied refresh token stayed valid for 7 days. | `User.tokenVersion` is stamped into every token and checked on every request and refresh. Logout bumps it, which signs out all of that account's devices. | `securityHardening` |
| F3 | 3.3.1 / 2.8 | Turning MFA on didn't sign out other devices, so a stolen session survived the owner securing the account. | Enabling or disabling MFA bumps `tokenVersion`. The device making the change gets fresh cookies; every other device is signed out. | `securityHardening` |
| F4 | 3.3.2 | **Sessions never expired while in use.** Each refresh issued a new 7-day refresh token. | The original login time (`at`) is carried through every refresh. Staff must log in again after **12 h**, everyone else after **30 days**. | `securityHardening` |
| F5 | 13.2.3 | CSRF protection relied only on `SameSite=Lax` cookies. Setting `COOKIE_SAME_SITE=none` (allowed since TASK-032) would have made body-less admin actions such as *approve Boardman* forgeable. | State-changing requests with a foreign `Origin` are rejected, whatever the cookie setting. | `securityHardening` |
| F6 | 8.2.1 | API responses (balances, bet slips, KYC status) had no cache directive. | `Cache-Control: no-store` on every `/api` response. | `securityHardening` |
| F7 | 5.1.3 | zod's `.url()` accepts `javascript:` links. KYC document and result-evidence links are shown to admins, so this was latent stored XSS against the most privileged accounts. | These fields accept `https://` only (max 2,048 chars, max 10 evidence links). | `securityHardening` |
| F8 | 5.1.1 / 7.2 | `PATCH /users/me` had no validation (empty or unlimited names, any email). Renames also went unrecorded, even though the insider-betting check (TASK-014) matches on names. | zod schema added, and every name change is written to the audit log as `PROFILE_NAME_CHANGED`. | `securityHardening` |
| F9 | 6.2 / 13.2 | With no `PAYSTACK_WEBHOOK_SECRET` set, the webhook HMAC key was an empty string anyone could use, so forged payment events would verify. | Verification fails closed when the secret is unset. | `deposits` |

Also fixed earlier today and relevant here: **TOTP codes are now single-use** (2.8.4); previously a code could be replayed within its 30 s window. Two **money bugs** were found by TASK-045's property tests: payouts could exceed the pool, and concurrent refunds paid twice.

## Open items

Priority: **P1** before real money goes live · **P2** before scaling or public launch · **P3** improvement.

| # | Pri | ASVS | Item | Recommendation |
|---|---|---|---|---|
| O1 | ~~P1~~ **Resolved** | 4.3.1 / 2.8 | MFA was optional for staff. | Every admin route now requires MFA once `STAFF_SECURITY_ENFORCED_FROM` has passed (default in production: immediately; a future date gives a grace period with a warning banner). Gated admins are redirected to `/admin/security`, which stays reachable. Tests: `staffSecurity`. |
| O2 | ~~P1~~ **Resolved** | 2.1.1 / 2.1.5 | Staff credentials could be 4 characters, and there was no way to change a password. | `POST /api/auth/password`: needs the current password (lockout-counted), staff minimum 12 characters, must not contain the phone number, signs out other devices, audited. A short staff password is detected at login and gates admin routes like O1. The seeded `Admin@12345` (11 characters) must therefore be changed at first production login. Tests: `staffSecurity`. |
| O3 | ~~P1~~ **Resolved** | 3.7.1 | A hijacked session could withdraw immediately. | Withdrawals require the PIN again, and wrong PINs count toward the lockout. The bank details are part of the same request, so this also covers changing where money goes. Tests: `withdrawalKycGate`. |
| O4 | P2 | 2.1.1 | **Bettor PINs are 4 digits.** L2 asks for 12+ character passwords. This is a product decision: mobile-money-style PINs suit the users. | Documented deviation, mitigated by F1 lockout, device fingerprinting (TASK-029) and KYC. Consider 6-digit PINs (100× harder to brute-force) before real money. |
| O5 | P2 | 2.2.1 / 11.1.4 | **Rate limits live in each process's memory.** They reset on every deploy and multiply with every API replica. (The per-account lockout in F1 is database-backed, so it isn't affected.) | Move `express-rate-limit` to a shared store (Redis, or Postgres) before running more than one API instance. |
| O6 | P2 | 6.4.1 / 14.1 | **Secrets are plain environment variables.** | TASK-033: AWS Secrets Manager (decision recorded: AWS af-south-1). |
| O7 | P2 | 2.5 | **There's no PIN-reset flow.** Users who forget their PIN have no self-service path. | When built: OTP to the registered phone, a notification to the user, a `tokenVersion` bump, and no reset via support without KYC checks. |
| O8 | P3 | 2.2.2 / 3.3 | Logout ends every session for that account, with no per-device session list. | Fine for now. Add a sessions table if "log out this device only" is ever needed. |
| O9 | P3 | 2.2.1 | Account existence can be discovered: registration says "already exists", and a locked account says it's locked. | Accepted. Phone-number sign-up makes this hard to avoid, and the lockout message helps real users. |
| O10 | P3 | 3.4.4 | Cookies don't use the `__Host-` prefix. | Rename to `__Host-sb_access` / `__Host-sb_refresh` in production (requires `Secure`, `Path=/`, no `Domain`). |

## Verified: meets L2

| Area | ASVS | Evidence |
|---|---|---|
| Password storage | 2.4 | bcrypt, cost 10, per-hash salt (`server/utils/password.js`) |
| MFA | 2.8 | TOTP (RFC 6238); single-use codes; ±1 step drift; secret never leaves the server; atomic consumption (`mfaService`) |
| Session cookies | 3.4 | `HttpOnly`; `Secure` in production and forced whenever `SameSite=None`; `SameSite=Lax` (TASK-032) |
| Access control | 4.1–4.3 | Every non-public route has `requireAuth`, a role check, and a named staff permission for admin actions (TASK-030). Queries are scoped to the owner (bet tickets, Boardman competitions). |
| SQL injection | 5.3.4 | Prisma parameterises everything; raw SQL only through tagged templates (`walletService`, `advisoryLock`); `$executeRawUnsafe` only in tests |
| XSS | 5.3.3 | React escapes output; SPA CSP has no `unsafe-inline`; API CSP is `default-src 'none'` (TASK-032 + fix) |
| Input validation | 5.1 | zod on every body-accepting route; bodies capped at 100 KB |
| Error handling | 7.4 | 500s return a generic message plus a `requestId`; stack traces stay in logs (TASK-041) |
| Logging | 7.1–7.3 | Structured JSON with request IDs; PINs, secrets, tokens, BVN/NIN and cookies redacted (TASK-041); security events audited (TASK-012) |
| Data protection | 8.3 | BVN/NIN stored only as hashes (TASK-026); the app's DB role can't run DDL (TASK-034) |
| Communications | 9.1 | HSTS with preload; TLS terminates at the load balancer (infra) |
| Supply chain | 10.3 / 14.2 | `npm audit` gate (high), Gitleaks, CodeQL, Dependabot (TASK-035) |
| Business logic | 11.1 | Idempotent payouts; row-locked refunds; ledger reconciliation; money-conservation property tests (TASK-045) |
| Webhooks | 13.2 | HMAC-SHA512 verified in constant time; idempotent credit; amount/currency cross-checked (TASK-004) |
| CORS | 14.5.3 | Single allowed origin with credentials; no wildcard |
| Headers | 14.4 | CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` |

## Not applicable yet

- **V12 Files:** there are no uploads. KYC and evidence are links. When uploads are built, follow the plan: presigned S3 uploads, content-type allowlist, malware scan, private bucket.
- **V9.2 Server-to-server TLS verification:** the only outbound call is to Paystack over `https`, using Node's default certificate verification.

## How to re-run

```bash
npm test                          # includes every test named above
npm run test:hermetic             # same, against a throwaway Postgres
PROPERTY_RUNS=300 npx jest tests/integration/moneyConservation.property.test.js
```
