const router = require('express').Router();
const betController = require('../controllers/betController');

// Public: anyone with a shared ticket link can check it (A3).
router.get('/:token', betController.getSharedTicket);

module.exports = router;
