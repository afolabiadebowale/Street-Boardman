const router = require('express').Router();
const otpController = require('../controllers/otpController');
const validate = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimit');
const { otpRequestSchema, otpVerifySchema } = require('../validators/schemas');

// Public — SIGNUP purpose has to work before an account exists.
// authLimiter (per IP) plus otpService's own per-phone cooldown
// (MIN_SECONDS_BETWEEN_REQUESTS) together cover both abuse angles.
router.post('/request', authLimiter, validate(otpRequestSchema), otpController.requestOtp);
router.post('/verify', authLimiter, validate(otpVerifySchema), otpController.verifyOtp);

module.exports = router;
