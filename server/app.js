const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const env = require('./config/env');
const routes = require('./routes');
const depositController = require('./controllers/depositController');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { requestId, httpLogger } = require('./middleware/requestLogger');
const requireSameOrigin = require('./middleware/sameOrigin');
const { apiLimiter } = require('./middleware/rateLimit');

const app = express();

// Must be set before any middleware that reads req.ip (rate limiters
// especially) — see env.trustProxyHops for why this can't just default to
// trusting everything (TASK-010).
app.set('trust proxy', env.trustProxyHops);

// First, so every request — including ones rejected by later middleware —
// gets an ID and a log line (TASK-041).
app.use(requestId);
app.use(httpLogger);

// This is a JSON-only API — the client SPA is a separate deployment, and
// nothing here ever renders HTML — so CSP can be locked all the way down
// instead of using helmet's page-oriented defaults (TASK-032).
app.use(
  helmet({
    contentSecurityPolicy: {
      // Without this, helmet merges its page-oriented defaults
      // (script-src, style-src 'unsafe-inline', ...) into the policy.
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    // frame-ancestors above already covers modern browsers; this is the
    // legacy header for anything that only understands X-Frame-Options.
    frameguard: { action: 'deny' },
  })
);
app.use(cors({ origin: env.clientOrigin, credentials: true, exposedHeaders: ['X-Request-Id'] }));
app.use(cookieParser());

// This one route needs the exact raw bytes of the request body to verify
// Paystack's signature, so it's wired up BEFORE express.json() below and
// bypasses the normal JSON body parser entirely.
app.post(
  '/api/deposits/paystack/webhook',
  express.raw({ type: 'application/json' }),
  depositController.paystackWebhook
);

app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true, mode: env.appMode }));

// API responses carry balances, bet slips and KYC status — never let a
// browser or shared proxy cache them (ASVS 8.2.1).
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api', apiLimiter, requireSameOrigin, routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
