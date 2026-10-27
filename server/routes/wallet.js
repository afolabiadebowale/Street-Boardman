const router = require('express').Router();
const requireAuth = require('../middleware/auth');
const walletController = require('../controllers/walletController');

router.use(requireAuth);
router.get('/me', walletController.getMyWallet);
router.get('/me/transactions', walletController.getMyTransactions);
router.get('/me/statement', walletController.getMyStatement);

module.exports = router;
