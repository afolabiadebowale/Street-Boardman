const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');
const env = require('../config/env');
const consentService = require('../services/consentService');

// Money actions need the current terms and privacy policy accepted
// (FEAT-060). The code lets the client show the re-consent screen.
const requireConsent = asyncHandler(async (req, res, next) => {
  if (!env.privacy.requireConsent) return next();
  const { required } = await consentService.consentStatus(req.user.id);
  if (required) throw new AppError('Please accept the updated terms and privacy policy to continue', 403, 'CONSENT_REQUIRED');
  next();
});

module.exports = requireConsent;
