const router = require('express').Router();
const requireAuth = require('../middleware/auth');
const validate = require('../middleware/validate');
const userController = require('../controllers/userController');
const { kycLimiter } = require('../middleware/rateLimit');
const { kycVerifySchema, updateMeSchema } = require('../validators/schemas');

router.use(requireAuth);
router.get('/me', userController.getMe);
router.patch('/me', validate(updateMeSchema), userController.updateMe);
router.post('/me/kyc/verify', kycLimiter, validate(kycVerifySchema), userController.verifyKyc);

module.exports = router;
