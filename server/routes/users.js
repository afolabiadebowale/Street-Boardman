const router = require('express').Router();
const requireAuth = require('../middleware/auth');
const validate = require('../middleware/validate');
const userController = require('../controllers/userController');
const { kycLimiter, exportLimiter } = require('../middleware/rateLimit');
const {
  kycVerifySchema,
  updateMeSchema,
  acceptPoliciesSchema,
  deleteAccountSchema,
  setGamblingLimitSchema,
  selfExclusionSchema,
} = require('../validators/schemas');
const requireRole = require('../middleware/requireRole');

router.use(requireAuth);
router.get('/me', userController.getMe);
router.patch('/me', validate(updateMeSchema), userController.updateMe);
router.post('/me/kyc/verify', kycLimiter, validate(kycVerifySchema), userController.verifyKyc);

// Data protection (FEAT-060)
router.get('/me/consent', userController.getConsent);
router.post('/me/consent', validate(acceptPoliciesSchema), userController.acceptPolicies);
router.get('/me/export', exportLimiter, userController.exportMyData);
router.post('/me/delete', validate(deleteAccountSchema), userController.deleteMe);

// Responsible gambling (A2): Betters only, since only they stake.
router.get('/me/gambling-controls', requireRole('BETTER'), userController.getGamblingControls);
router.put('/me/limits', requireRole('BETTER'), validate(setGamblingLimitSchema), userController.setGamblingLimit);
router.post('/me/self-exclusion', requireRole('BETTER'), validate(selfExclusionSchema), userController.selfExclude);
router.post('/me/cooling-off', requireRole('BETTER'), userController.coolOff);

module.exports = router;
