const asyncHandler = require('../utils/asyncHandler');
const otpService = require('../services/otpService');
const env = require('../config/env');

const requestOtp = asyncHandler(async (req, res) => {
  const { phone, purpose } = req.body;
  const result = await otpService.requestOtp(phone, purpose);
  // The code itself is never in the response in PRODUCTION — DEMO mode
  // already logs it server-side (smsProvider's console stub); nothing
  // client-facing needs it either way.
  res.status(201).json({ expiresAt: result.expiresAt, demoMode: env.appMode === 'DEMO' });
});

const verifyOtp = asyncHandler(async (req, res) => {
  const { phone, purpose, code } = req.body;
  const result = await otpService.verifyOtp(phone, purpose, code);
  res.json(result);
});

module.exports = { requestOtp, verifyOtp };
