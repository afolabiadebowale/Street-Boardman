# StreetBoardman — Architecture & Design (v0.1, pre-code)

Status: DESIGN ONLY. No application code has been written yet. This document
is the reference we build against. It should be updated whenever a design
decision changes.

---

## 1. High-Level Architecture

```
┌─────────────────────────────┐
│   React SPA (mobile-first)  │  <-- one app, 3 role-based route trees
│   /better  /boardman /admin │
└──────────────┬───────────────┘
               │ REST (JSON) over HTTPS
               │ JWT in httpOnly cookie
┌──────────────▼───────────────┐
│  Express API (Node.js)       │
│  routes → middleware →       │
│  controllers → services      │
└───────┬───────────────┬──────┘
        │               │
        │               │ webhook (server-to-server, signed)
┌───────▼──────┐  ┌──────▼───────┐
│ PostgreSQL   │  │  Paystack    │
│ via Prisma   │  │  (payments)  │
└──────────────┘  └──────────────┘
```

**Why one React app instead of three separate apps:** simpler to build and
deploy while learning, and a Better should never accidentally land on
Boardman/Admin screens because routes are guarded both by the router *and*
by the backend (role check on every request, not just hidden UI). If this
ever needs to be split (e.g. Admin on its own subdomain for extra
isolation), the route trees are already separated so it's a low-cost move
later.

**Layering on the server**, request always flows in one direction:

```
routes (define URL + HTTP method)
  → middleware (auth, role check, validation, rate limit)
    → controller (parses request, calls service, shapes response)
      → service (business logic: betting, payout, commission, wallet)
        → Prisma model (talks to PostgreSQL)
```

Controllers never talk to the database directly, and never contain money
math — that all lives in `services/`, especially `commissionService.js` and
`payoutService.js`, so it can be unit-tested in isolation from HTTP.

---

## 2. User Roles & Permissions

Three roles, one `User` table, discriminated by a `role` column. Boardman
gets an extra `BoardmanProfile` row. There is no public "become an Admin"
path anywhere — Admin accounts are seeded directly in the database.

| Action | Better | Boardman | Admin |
|---|---|---|---|
| Register via public form | ✅ | ✅ (pending approval) | ❌ never |
| Deposit / withdraw own wallet | ✅ | ✅ (commission payouts) | n/a |
| Place bets | ✅ | ❌ | ❌ |
| Create/manage competitions | ❌ | ✅ (own only) | 👁 view all |
| Submit competition result | ❌ | ✅ (own only) | ❌ |
| Confirm a normal result | system (auto, see §10) | ❌ own result | ✅ disputed only |
| Resolve disputes | ❌ | ❌ | ✅ |
| Approve/suspend Boardmen | ❌ | ❌ | ✅ |
| Suspend Betters | ❌ | ❌ | ✅ |
| Configure commission rates | ❌ | ❌ | ✅ |
| Manually edit wallet balances | ❌ | ❌ | ❌ (adjustment transactions only, never a silent edit — see §9) |

Enforcement is **server-side only**. Every protected route runs a
`requireRole('BETTER'|'BOARDMAN'|'ADMIN')` middleware; the frontend hiding a
button is a UX nicety, never the actual permission check.

---

## 3. User Journeys

**Better**
Register → deposit demo funds → browse open competitions → pick an option →
stake → get digital bet ticket → wait for result → win → wallet credited →
withdraw.

**Boardman**
Register (name, phone, PIN, location, optional KYC) → status
`PENDING_APPROVAL` → Admin approves → create competition (participants,
betting options, deadline) → share/monitor bets → betting deadline hits,
close betting → run the real-world event → submit result + evidence →
result auto-confirms (or Admin resolves if disputed) → commission lands in
Boardman wallet → withdraw.

**Admin**
Log in (seeded account, no public signup) → review pending Boardmen →
approve/reject → monitor live competitions/bets/disputes → resolve any
disputed result → adjust commission settings → review ledger/reports.

---

## 4. Core State Machines

**Competition lifecycle**

```
DRAFT → BETTING_OPEN → BETTING_CLOSED → PENDING_CONFIRMATION
      → RESULT_CONFIRMED → PAYOUT_PROCESSING → COMPLETED
                          ↘ DISPUTED → (admin) RESULT_CONFIRMED | CANCELLED_REFUNDED
```

- `DRAFT`: Boardman is still setting up participants/options, not visible to Betters yet.
- `BETTING_OPEN`: visible, bets accepted.
- `BETTING_CLOSED`: deadline passed or Boardman closed it manually; no new bets; event happens in real life.
- `PENDING_CONFIRMATION`: Boardman submitted a result; confirmation window running (see §10).
- `RESULT_CONFIRMED`: locked in, safe to pay out.
- `DISPUTED`: a Better (or the Boardman) flagged the result during the confirmation window; all payouts frozen; only Admin can move it forward.
- `PAYOUT_PROCESSING` → `COMPLETED`: payout engine has run, everything settled.
- `CANCELLED_REFUNDED`: Admin (or Boardman before any bets close) cancels; all stakes refunded, no commission taken.

**Bet lifecycle:** `OPEN → WON | LOST | REFUNDED | VOID`

**Boardman approval:** `PENDING_APPROVAL → APPROVED | REJECTED`, plus `SUSPENDED` (Admin only, any time).

**User status:** `ACTIVE ↔ SUSPENDED` (Admin only).

---

## 5–6. Database Schema & Relationships

Described here in plain field lists — actual Prisma schema syntax comes in
the first coding step.

```
User
 - id, role [BETTER|BOARDMAN|ADMIN], fullName, phone (unique), email (nullable),
   passwordHash, pinHash, status [ACTIVE|SUSPENDED], isDemo, createdAt
 - 1–1 BoardmanProfile   (only when role = BOARDMAN)
 - 1–1 Wallet
 - 1–N Bet               (as the better placing bets)
 - 1–N Deposit, 1–N Withdrawal
 - 1–N Competition       (as the owning boardman, via BoardmanProfile)
 - 1–N AuditLog          (as actor)

BoardmanProfile
 - id, userId (FK, unique), businessLocation, kycDocumentUrl (nullable),
   approvalStatus [PENDING_APPROVAL|APPROVED|REJECTED|SUSPENDED],
   commissionRateOverride (nullable — falls back to SystemSetting default),
   approvedByAdminId (nullable), approvedAt

Wallet
 - id, userId (FK, unique), walletType [BETTER|BOARDMAN|PLATFORM],
   balance (decimal), currency, isDemo
 - 1–N WalletTransaction

WalletTransaction   (append-only ledger — never edited, never deleted)
 - id, walletId (FK), type [DEPOSIT|WITHDRAWAL|BET_STAKE|BET_WIN|
   COMMISSION|REFUND|ADJUSTMENT], amount, balanceBefore, balanceAfter,
   referenceType, referenceId, createdAt

Competition
 - id, boardmanId (FK → User), title, category [FOOTBALL|SNOOKER|FIGHT|
   TABLE_GAME|OTHER], status (see §4), bettingDeadline,
   boardmanCommissionRate (snapshotted at creation), platformCommissionRate
   (snapshotted at creation), isDemo, createdAt
 - 1–N CompetitionParticipant
 - 1–N BetOption
 - 1–1 Result
 - 1–1 Commission
 - 1–N Dispute

CompetitionParticipant
 - id, competitionId (FK), name, imageUrl (nullable)

BetOption
 - id, competitionId (FK), label (e.g. "Tunde wins"), participantId (nullable, FK)
 - 1–N Bet

Bet
 - id, betCode (unique, e.g. "SB-000123"), betterId (FK → User),
   competitionId (FK), betOptionId (FK), stake, potentialPayout,
   status [OPEN|WON|LOST|REFUNDED|VOID], placedAt
 - 1–1 Payout (nullable until processed)

Result
 - id, competitionId (FK, unique), submittedByBoardmanId (FK), winningOptionId (FK),
   finalScore (nullable text), evidenceUrls (string array), notes,
   status [PENDING_CONFIRMATION|CONFIRMED|DISPUTED|CANCELLED],
   confirmationDeadline, confirmedByAdminId (nullable), confirmedAt (nullable)

Payout
 - id, betId (FK, unique), amount, status [PENDING|PROCESSED|FAILED],
   idempotencyKey (unique), processedAt

Commission
 - id, competitionId (FK, unique), boardmanId (FK), totalStakePool,
   boardmanAmount, platformAmount, calculatedAt

Deposit
 - id, userId (FK), amount, provider [DEMO|PAYSTACK],
   providerReference (unique, nullable for demo), status [PENDING|SUCCESSFUL|FAILED],
   verifiedAt

Withdrawal
 - id, userId (FK), amount, destination (bank details JSON),
   status [PENDING|PROCESSING|PROCESSED|FAILED|REJECTED], requestedAt,
   processedAt, transferReference (unique, Paystack idempotency key),
   transferCode, transferInitiatedAt, failureReason

Dispute
 - id, competitionId (FK), raisedByUserId (FK), reason,
   status [OPEN|UNDER_REVIEW|RESOLVED_CONFIRMED|RESOLVED_CANCELLED],
   resolvedByAdminId (nullable), resolvedAt (nullable)

AuditLog
 - id, actorUserId (FK, nullable for system actions), action, entityType,
   entityId, beforeState (JSON), afterState (JSON), createdAt

SystemSetting
 - id, key (unique, e.g. "boardmanCommissionRate", "platformCommissionRate",
   "resultConfirmationWindowHours", "demoMode"), value, updatedByAdminId,
   updatedAt
```

Key relationship notes:
- Every `User` has exactly one `Wallet`, including a singleton `PLATFORM`
  wallet owned by a system/admin account — commissions flow there.
- `Competition.boardmanCommissionRate` / `platformCommissionRate` are
  **snapshotted at creation time** from `SystemSetting` (or the Boardman's
  override), so changing the global rate later never rewrites the math on
  past or in-flight competitions.
- `AuditLog` is polymorphic (`entityType` + `entityId`) so it can point at
  any table without needing a foreign key to every single one.
- Nothing about money is ever hard-deleted. Cancellations and corrections
  are new rows (`REFUND`, `ADJUSTMENT`), never edits to old ones.

---

## 7. Folder Structure

```
streetboardman/
├── client/                      React app (mobile-first, PWA)
│   ├── src/
│   │   ├── routes/better/
│   │   ├── routes/boardman/
│   │   ├── routes/admin/
│   │   ├── components/
│   │   ├── api/                 fetch wrappers per resource
│   │   └── context/             auth/session context
│   └── public/                  manifest.json, service worker, icons
│
├── server/
│   ├── routes/                  URL + method → controller wiring only
│   ├── controllers/             request/response shaping
│   ├── services/                business logic (commissionService.js,
│   │                            bettingService.js, payoutService.js,
│   │                            walletService.js, resultService.js)
│   ├── middleware/               auth.js, requireRole.js, validate.js,
│   │                            rateLimit.js, auditLog.js
│   ├── models/                  Prisma client accessors (thin wrappers)
│   ├── utils/                   helpers (money formatting, id generation)
│   └── config/                  env loading, db connection, constants
│
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│
├── tests/
├── docs/                        this file + the 3 manuals + API docs
└── README.md
```

---

## 8. API Structure

All routes are versioned under `/api`. Auth via JWT in an httpOnly cookie;
role required per route as noted.

```
POST   /api/auth/register/better
POST   /api/auth/register/boardman
POST   /api/auth/login
POST   /api/auth/logout

GET    /api/users/me                      [any authenticated role]
PATCH  /api/users/me                      [any]

GET    /api/boardmen/me                   [BOARDMAN]
GET    /api/admin/boardmen                [ADMIN]
PATCH  /api/admin/boardmen/:id/approve    [ADMIN]
PATCH  /api/admin/boardmen/:id/reject     [ADMIN]
PATCH  /api/admin/boardmen/:id/suspend    [ADMIN]

GET    /api/wallet/me                     [any]
GET    /api/wallet/me/transactions        [any]

POST   /api/deposits/demo                 [BETTER|BOARDMAN, demo mode]
POST   /api/deposits/paystack/initialize  [BETTER]
POST   /api/deposits/paystack/webhook     [Paystack server only, signed]

POST   /api/withdrawals                   [BETTER|BOARDMAN]
GET    /api/withdrawals/me                [BETTER|BOARDMAN]
PATCH  /api/admin/withdrawals/:id         [ADMIN]

POST   /api/competitions                  [BOARDMAN, approved only]
GET    /api/competitions                  [any — public listing of BETTING_OPEN]
GET    /api/competitions/:id              [any]
PATCH  /api/competitions/:id/close-betting[BOARDMAN, own only]
POST   /api/competitions/:id/result       [BOARDMAN, own only]

POST   /api/bets                          [BETTER]
GET    /api/bets/me                       [BETTER]
GET    /api/bets/:betCode                 [owning BETTER]

POST   /api/results/:id/dispute           [BETTER|BOARDMAN]
PATCH  /api/admin/disputes/:id/resolve    [ADMIN]

GET    /api/admin/competitions            [ADMIN]
GET    /api/admin/bets                    [ADMIN]
GET    /api/admin/ledger                  [ADMIN]
GET    /api/admin/reports                 [ADMIN]
GET    /api/admin/audit-logs              [ADMIN]
PATCH  /api/admin/settings                [ADMIN]  boardmanCommissionRate,
                                                    platformCommissionRate,
                                                    resultConfirmationWindowHours
```

Each endpoint will get a full doc entry (method, auth, request body,
response, error cases) in `docs/API.md` as it's built.

---

## 9. Financial Flow

```
Deposit (demo or Paystack, webhook-verified)
   → WalletTransaction(DEPOSIT) → Better Wallet balance += amount
Bet placed
   → WalletTransaction(BET_STAKE) → Better Wallet balance -= stake
     (inside one DB transaction with Bet row creation)
Result CONFIRMED → Payout Engine runs (see §10)
   → for each winning bet:
       WalletTransaction(BET_WIN) → Better Wallet balance += payout
   → WalletTransaction(COMMISSION) → Boardman Wallet balance += boardmanAmount
   → WalletTransaction(COMMISSION) → Platform Wallet balance += platformAmount
Withdrawal requested
   → WalletTransaction(WITHDRAWAL): wallet debited, status PENDING
Admin processes it
   → PROCESSING (one atomic claim) → Paystack transfer, reference wd_<id>
   → transfer.success webhook → PROCESSED
   → transfer.failed / transfer.reversed → FAILED + WalletTransaction(ADJUSTMENT) refund
   → no webhook after 15 min → worker asks Paystack by reference and settles
```

Every wallet balance change happens **only** as a side effect of writing a
`WalletTransaction` row inside a database transaction — the wallet's
`balance` column is always `previous balance + this transaction's delta`,
never edited directly. If a mistake needs correcting, Admin creates an
`ADJUSTMENT` transaction (positive or negative) with a required reason,
which is written to `AuditLog` — so the ledger always explains itself and
nothing is silently changed, exactly as required in §4/§10 of the spec.

Real money (Paystack) is only ever confirmed by the **webhook**, never by
the browser redirect — the client polls "has this deposit gone through?"
against our own DB, which is only updated once Paystack's server calls our
webhook and we verify its signature.

---

## 10. Result / Verdict Flow (detail)

This is the trust-critical part of the system, so it gets an explicit
design, not just the state diagram from §4:

1. Boardman closes betting (manually, or automatically at
   `bettingDeadline`).
2. Boardman submits a result: winning option, optional score, optional
   evidence (photo/video URL), notes.
3. Competition/Result → `PENDING_CONFIRMATION`, with a
   `confirmationDeadline` = now + `resultConfirmationWindowHours`
   (Admin-configurable `SystemSetting`, default suggestion: 2 hours).
4. During that window, **any Better with a bet on that competition, or the
   Boardman themself, can raise a dispute** → Result/Competition →
   `DISPUTED`, all payouts frozen immediately, regardless of window.
5. If no dispute is raised before `confirmationDeadline`, a scheduled job
   (or a check on next access) auto-transitions Result → `CONFIRMED`, which
   triggers the Payout Engine.
6. Admin can also manually confirm before the deadline if everyone's happy
   and waiting is pointless (e.g. small friendly competition, everyone
   present agrees).
7. If `DISPUTED`: only Admin can resolve — either `RESOLVED_CONFIRMED`
   (picks/confirms the winning option, which may differ from what the
   Boardman submitted) or `RESOLVED_CANCELLED` (competition cancelled, all
   stakes refunded via `REFUND` transactions, no commission taken).

A Boardman can never confirm their own disputed result — that path is
Admin-only, matching the "must not approve their own disputed results"
requirement.

---

## 11. Security Architecture

- **Auth**: JWT (short-lived access token + refresh token) stored in
  httpOnly, secure, sameSite cookies — not localStorage, to reduce XSS
  token theft risk. Passwords and Boardman PINs hashed with bcrypt.
- **Authorization**: `requireRole()` middleware on every protected route,
  plus ownership checks (e.g. a Boardman can only close/submit results for
  competitions where `competition.boardmanId === req.user.id`).
- **Input validation**: schema validation (e.g. Zod or Joi) on every
  request body before it reaches a controller.
- **Rate limiting**: on `/auth/*` (brute force) and `/bets` (spam).
- **Payment verification**: Paystack webhook signature verified server-side
  using the webhook secret; browser-side "success" callbacks are treated as
  a hint to poll, never as proof of payment.
- **Database transactions**: bet placement, payout processing, and any
  multi-row financial write happen inside a single Prisma `$transaction`.
- **Idempotency**: payouts and webhook handlers use an idempotency key
  (e.g. `payout:<betId>`, `webhook:<paystackEventId>`) so retries can never
  double-credit a wallet.
- **Audit logging**: every admin action, every commission-rate change,
  every wallet adjustment, every dispute resolution writes an `AuditLog`
  row.
- **Transport**: HTTPS everywhere in production, `helmet` for HTTP headers,
  CORS locked to the known frontend origin.

---

## 12. Development Roadmap

Built in demo money first (per §15 of the spec); Paystack only wired in
near the end.

1. **Scaffolding** — repo structure, Express skeleton, Prisma + Postgres
   connection, React app skeleton with the three route trees, health-check
   endpoint.
2. **Auth & Users** — register (Better/Boardman), login, JWT middleware,
   role middleware, seeded Admin account.
3. **Wallets & demo deposits** — Wallet + WalletTransaction models, demo
   top-up endpoint, transaction history view.
4. **Boardman approval** — PENDING_APPROVAL flow, Admin approve/reject
   screen.
5. **Competitions** — create/list/view, participants, bet options, betting
   deadline, DRAFT→BETTING_OPEN.
6. **Betting engine** — place bet (balance check, deadline check, DB
   transaction, bet ticket), bet history.
7. **Closing betting & result submission** — manual/automatic close,
   Boardman result submission with evidence upload.
8. **Confirmation & disputes** — confirmation window/job, dispute raising,
   Admin dispute resolution screen.
9. **Payout engine** — commission calculation service, payout processing,
   idempotency, COMPLETED state.
10. **Withdrawals (demo)** — request, Admin/queue processing.
11. **Admin settings & reporting** — commission configuration, ledger view,
    audit log viewer, basic reports.
12. **Paystack integration** — real deposit initialization + webhook,
    production-mode switch.
13. **PWA & mobile polish** — manifest, service worker, offline competition
    caching, large-tap UI pass.
14. **Testing** — unit tests for services (commission, payout, wallet
    math), integration tests for the critical flows in spec §20.
15. **Documentation** — keep the three manuals and API docs synchronized as
    each phase lands.
16. **Deployment** — env var docs, hosting, HTTPS, backups, monitoring.

---

## Design decisions I made a call on (flag if you want it different)

- **Single React app** with three guarded route trees, rather than three
  separate frontend apps — simpler for now, backend still enforces roles
  independently either way.
- **JWT in httpOnly cookies** rather than sessions or bearer tokens in
  localStorage — avoids common XSS token-theft issues while staying simple.
- **Auto-confirm after a timed window** (default 2h, admin-configurable)
  instead of requiring every single result to get manual admin
  confirmation — keeps normal (non-disputed) competitions fast, while still
  giving Betters/Boardman a window to flag a problem. Disputes always
  escalate to Admin regardless of the window.

Tell me if any of these three should go differently, otherwise we proceed
to Phase 1 (scaffolding) next.
