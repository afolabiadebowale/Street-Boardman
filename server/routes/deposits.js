const router = require('express').Router();
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const requireConsent = require('../middleware/requireConsent');
const depositController = require('../controllers/depositController');
const { demoDepositSchema, paystackInitializeSchema } = require('../validators/schemas');

// Note: the Paystack webhook route is mounted separately in server/app.js,
// BEFORE this router, because it needs the raw request body (for signature
// verification) instead of the parsed JSON body every other route gets.

router.use(requireAuth);
router.post('/demo', requireRole('BETTER', 'BOARDMAN'), requireConsent, validate(demoDepositSchema), depositController.createDemoDeposit);
router.post('/paystack/initialize', requireRole('BETTER'), requireConsent, validate(paystackInitializeSchema), depositController.initializePaystack);
router.get('/me', depositController.listMyDeposits);

module.exports = router;
