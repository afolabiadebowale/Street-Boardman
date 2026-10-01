const rateLimit = require('express-rate-limit');

// Tight limit on auth endpoints to slow down brute-force login/PIN guessing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later.' },
});

// Looser limit on betting so a script can't flood the book with bets.
const bettingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, slow down.' },
});

// Ceiling on every API request per IP, in front of the route-specific
// limits. Generous: the load test's busiest simulated user makes ~40
// requests a minute. It caps scripted abuse of any endpoint, including
// ones whose handlers do authorization work (bcrypt, DB lookups).
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, slow down.' },
});

// Per signed-in user rather than per IP: these sit behind requireAuth, and
// a user's own account is what's being protected (or, for KYC, what each
// paid provider lookup is charged to).
function perUserLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `user:${req.user.id}`,
    message: { error: message },
  });
}

// Each BVN/NIN lookup is a paid call to the KYC provider in production.
const kycLimiter = perUserLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many verification attempts. Try again in an hour.',
});

const withdrawalLimiter = perUserLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many withdrawal requests. Try again later.',
});

// MFA enrollment and disabling: a stolen session must not be able to
// grind through codes.
const mfaManageLimiter = perUserLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many attempts, please try again later.',
});

module.exports = { authLimiter, bettingLimiter, apiLimiter, kycLimiter, withdrawalLimiter, mfaManageLimiter };
