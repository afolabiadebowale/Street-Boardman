const router = require('express').Router();
const requireAuth = require('../middleware/auth');
const validate = require('../middleware/validate');
const userController = require('../controllers/userController');
const { kycLimiter, exportLimiter } = require('../middleware/rateLimit');
const { kycVerifySchema, updateMeSchema, acceptPoliciesSchema, deleteAccountSchema } = require('../validators/schemas');

router.use(requireAuth);
router.get('/me', userController.getMe);
router.patch('/me', validate(updateMeSchema), userController.updateMe);
router.post('/me/kyc/verify', kycLimiter, validate(kycVerifySchema), userController.verifyKyc);

// Data protection (FEAT-060)
router.get('/me/consent', userController.getConsent);
router.post('/me/consent', validate(acceptPoliciesSchema), userController.acceptPolicies);
router.get('/me/export', exportLimiter, userController.exportMyData);
router.post('/me/delete', validate(deleteAccountSchema), userController.deleteMe);

module.exports = router;
