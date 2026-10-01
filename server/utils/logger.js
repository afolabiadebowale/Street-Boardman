const pino = require('pino');
const { getContext } = require('./requestContext');

// Anything that can carry a credential or identity number. pino-http only
// serializes headers (never bodies), but services log arbitrary objects,
// so each field is covered both at the top level and one level deep —
// in pino's redact syntax `*.pin` does NOT match a top-level `pin`.
const SENSITIVE_FIELDS = ['pin', 'password', 'passwordHash', 'mfaSecret', 'mfaToken', 'token', 'bvn', 'nin'];
const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  ...SENSITIVE_FIELDS,
  ...SENSITIVE_FIELDS.map((field) => `*.${field}`),
];

function defaultLevel() {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL;
  // Tests assert on logger calls via spies, not on output.
  return process.env.NODE_ENV === 'test' ? 'silent' : 'info';
}

function prettyTransport() {
  if (process.env.NODE_ENV !== 'development') return undefined;
  try {
    require.resolve('pino-pretty');
    return { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } };
  } catch {
    return undefined;
  }
}

function buildLogger({ level = defaultLevel(), destination } = {}) {
  const options = {
    level,
    base: { service: process.env.SERVICE_NAME || 'streetboardman' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    mixin() {
      return getContext() || {};
    },
  };
  if (destination) return pino(options, destination);
  const transport = prettyTransport();
  return transport ? pino({ ...options, transport }) : pino(options);
}

const logger = buildLogger();

module.exports = logger;
module.exports.buildLogger = buildLogger;
