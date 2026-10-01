const Sentry = require('@sentry/node');
const { getContext } = require('./requestContext');

// Error tracking (TASK-042). Entirely inert until SENTRY_DSN is set, so
// local dev, tests, and any environment without a Sentry project behave
// exactly as before — the same "real integration, nothing to configure
// until the account exists" pattern as the SMS/KYC/payment stubs.
let enabled = false;

// Exact key names, not substrings — a substring match on "nin" would also
// wipe fields like winningOptionId.
const SENSITIVE_KEYS = new Set(
  ['pin', 'password', 'passwordhash', 'secret', 'mfasecret', 'token', 'mfatoken', 'cookie', 'set-cookie', 'authorization', 'bvn', 'nin']
);

function scrub(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4) return value;
  for (const key of Object.keys(value)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) value[key] = '[REDACTED]';
    else value[key] = scrub(value[key], depth + 1);
  }
  return value;
}

function beforeSend(event) {
  if (event.request) {
    delete event.request.cookies;
    scrub(event.request.headers);
    scrub(event.request.data);
  }
  scrub(event.extra);
  return event;
}

function initErrorTracking({ dsn = process.env.SENTRY_DSN, transport } = {}) {
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE,
    sendDefaultPii: false,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
    beforeSend,
    ...(transport ? { transport } : {}),
  });
  enabled = true;
  return true;
}

// Tags each event with the active requestId, or job + tickId for worker
// sweeps (TASK-041), so a Sentry issue links straight to its log lines.
function withContextScope(extra, fn) {
  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(getContext() || {})) scope.setTag(key, value);
    if (extra) scope.setExtras(extra);
    fn();
  });
}

function captureException(err, extra) {
  if (!enabled) return;
  withContextScope(extra, () => Sentry.captureException(err));
}

// For conditions that aren't thrown errors but still need a human —
// e.g. payout retries exhausted, or a reconciliation mismatch.
function captureMessage(message, extra, level = 'error') {
  if (!enabled) return;
  withContextScope(extra, () => Sentry.captureMessage(message, level));
}

async function flush(timeoutMs = 2000) {
  if (enabled) await Sentry.flush(timeoutMs);
}

module.exports = { initErrorTracking, captureException, captureMessage, flush, beforeSend };
