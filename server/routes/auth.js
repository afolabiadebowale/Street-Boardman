const router = require('express').Router();
const authController = require('../controllers/authController');
const validate = require('../middleware/validate');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { authLimiter, mfaManageLimiter } = require('../middleware/rateLimit');
const {
  registerBetterSchema,
  registerBoardmanSchema,
  loginSchema,
  mfaVerifySchema,
  mfaCodeSchema,
  changePasswordSchema,
} = require('../validators/schemas');

router.post('/register/better', authLimiter, validate(registerBetterSchema), authController.registerBetter);
router.post('/register/boardman', authLimiter, validate(registerBoardmanSchema), authController.registerBoardman);
router.post('/login', authLimiter, validate(loginSchema), authController.login);
router.post('/mfa/verify', authLimiter, validate(mfaVerifySchema), authController.mfaVerify);
router.post('/refresh', authLimiter, authController.refresh);
router.post('/logout', authController.logout);
router.post('/password', authLimiter, requireAuth, validate(changePasswordSchema), authController.changePassword);

// MFA enrollment/management (TASK-031) — only for already-authenticated
// ADMIN accounts, since staff are the only accounts this covers.
router.post('/mfa/setup', requireAuth, requireRole('ADMIN'), mfaManageLimiter, authController.mfaSetupStart);
router.post(
  '/mfa/setup/confirm',
  requireAuth,
  requireRole('ADMIN'),
  mfaManageLimiter,
  validate(mfaCodeSchema),
  authController.mfaSetupConfirm
);
router.post(
  '/mfa/disable',
  requireAuth,
  requireRole('ADMIN'),
  mfaManageLimiter,
  validate(mfaCodeSchema),
  authController.mfaDisable
);

module.exports = router;
