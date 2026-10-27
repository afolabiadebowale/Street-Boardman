const router = require('express').Router();
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const requireConsent = require('../middleware/requireConsent');
const { bettingLimiter } = require('../middleware/rateLimit');
const betController = require('../controllers/betController');
const { placeBetSchema } = require('../validators/schemas');

router.use(requireAuth, requireRole('BETTER'));
router.post('/', bettingLimiter, requireConsent, validate(placeBetSchema), betController.placeBet);
router.get('/me', betController.listMyBets);
router.get('/:betCode', betController.getTicket);

module.exports = router;
