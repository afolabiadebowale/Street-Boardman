// Integration tests run with NODE_ENV=test and load .env.test instead of
// .env, so `npm test` never points at your everyday development database —
// see docs/TESTING.md.
require('dotenv').config({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// The dev-friendly fallback below only ever protects local development —
// in production it would mean the app runs with a well-known, forgeable
// JWT secret. This throws at startup instead of letting that happen
// silently (TASK-008).
const DEV_DEFAULT_ACCESS_SECRET = 'dev-access-secret';
const DEV_DEFAULT_REFRESH_SECRET = 'dev-refresh-secret';
const DEV_DEFAULT_MFA_CHALLENGE_SECRET = 'dev-mfa-challenge-secret';
const MIN_SECRET_LENGTH = 32;

function requiredJwtSecret(name, devDefault) {
  const value = required(name, devDefault);
  const nodeEnv = process.env.NODE_ENV || 'development';
  if (nodeEnv === 'production') {
    if (value === devDefault) {
      throw new Error(
        `${name} is still set to its development default — refusing to start in production`
      );
    }
    if (value.length < MIN_SECRET_LENGTH) {
      throw new Error(`${name} must be at least ${MIN_SECRET_LENGTH} characters in production`);
    }
  }
  return value;
}

const NODE_ENV = process.env.NODE_ENV || 'development';

// When the staff security gate (MFA + 12-char password) starts blocking
// admin actions. A future date is a grace period: staff see a warning
// banner until then. Production defaults to enforced now; elsewhere it's
// off unless set, so local development and tests aren't gated.
function parseStaffSecurityEnforcedFrom() {
  const raw = process.env.STAFF_SECURITY_ENFORCED_FROM;
  if (!raw) return NODE_ENV === 'production' ? new Date(0) : null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`STAFF_SECURITY_ENFORCED_FROM must be a date (e.g. 2026-11-01), got "${raw}"`);
  }
  return date;
}

const ALLOWED_SAME_SITE = ['lax', 'strict', 'none'];
const cookieSameSite = (process.env.COOKIE_SAME_SITE || 'lax').toLowerCase();
if (!ALLOWED_SAME_SITE.includes(cookieSameSite)) {
  throw new Error(`COOKIE_SAME_SITE must be one of ${ALLOWED_SAME_SITE.join(', ')}, got "${cookieSameSite}"`);
}

module.exports = {
  nodeEnv: NODE_ENV,
  port: Number(process.env.PORT || 4000),
  appMode: process.env.APP_MODE || 'DEMO', // 'DEMO' | 'PRODUCTION'
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',

  // Cross-site deployments (client and API on different registrable
  // domains) need SameSite=None to have the browser send the session
  // cookie on API fetches at all — but browsers silently drop None
  // cookies that aren't also Secure, which would look like login
  // "succeeding" and then every subsequent request being unauthenticated.
  // Forcing secure here whenever sameSite is 'none' (regardless of
  // NODE_ENV) turns that into a loud failure in dev instead (TASK-032).
  cookies: {
    sameSite: cookieSameSite,
    secure: NODE_ENV === 'production' || cookieSameSite === 'none',
  },

  // The running server/worker connect with a least-privilege DB role that
  // can only read/write existing rows, not run DDL (see prisma/roles.sql,
  // TASK-034). Falls back to DATABASE_URL — the migrator/owner
  // connection — when unset, so this is opt-in and never breaks an
  // environment that hasn't provisioned the restricted role yet.
  appDatabaseUrl: process.env.APP_DATABASE_URL || required('DATABASE_URL'),

  staffSecurityEnforcedFrom: parseStaffSecurityEnforcedFrom(),

  // Number of reverse-proxy hops (load balancer, CDN, etc.) Express should
  // trust the X-Forwarded-For chain through when determining req.ip. This
  // MUST match the real deployment topology: 0 (the default) is correct
  // for no proxy in front — but wrong, and a rate-limiting bug (every user
  // appears to share one IP), the moment a proxy IS introduced without
  // updating this (TASK-010). Whoever stands up the production
  // load balancer/proxy (see infra work) sets this to the exact hop count.
  trustProxyHops: process.env.TRUST_PROXY_HOPS !== undefined ? Number(process.env.TRUST_PROXY_HOPS) : 0,

  jwt: {
    accessSecret: requiredJwtSecret('JWT_ACCESS_SECRET', DEV_DEFAULT_ACCESS_SECRET),
    refreshSecret: requiredJwtSecret('JWT_REFRESH_SECRET', DEV_DEFAULT_REFRESH_SECRET),
    // Deliberately a DIFFERENT secret from accessSecret (TASK-031) — an MFA
    // challenge token proves "password was correct" only, not "second
    // factor was verified". If it were signed with accessSecret it would
    // double as a fully valid session token and requireAuth would accept it
    // as-is, defeating the whole point of the second step.
    mfaChallengeSecret: requiredJwtSecret('JWT_MFA_CHALLENGE_SECRET', DEV_DEFAULT_MFA_CHALLENGE_SECRET),
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '7d',
    mfaChallengeTtl: process.env.JWT_MFA_CHALLENGE_TTL || '5m',
  },

  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY || '',
    publicKey: process.env.PAYSTACK_PUBLIC_KEY || '',
    webhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET || '',
  },

  defaults: {
    boardmanCommissionRate: Number(process.env.DEFAULT_BOARDMAN_COMMISSION_RATE || 0.05),
    platformCommissionRate: Number(process.env.DEFAULT_PLATFORM_COMMISSION_RATE || 0.03),
    resultConfirmationWindowHours: Number(process.env.DEFAULT_RESULT_CONFIRMATION_WINDOW_HOURS || 2),
  },
};
