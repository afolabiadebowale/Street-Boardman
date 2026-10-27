const router = require('express').Router();

router.use('/auth', require('./auth'));
router.use('/otp', require('./otp'));
router.use('/users', require('./users'));
router.use('/boardmen', require('./boardmen'));
router.use('/wallet', require('./wallet'));
router.use('/deposits', require('./deposits'));
router.use('/withdrawals', require('./withdrawals'));
router.use('/competitions', require('./competitions'));
router.use('/bets', require('./bets'));
router.use('/notifications', require('./notifications'));
router.use('/uploads', require('./uploads'));
router.use('/tickets', require('./tickets'));
router.use('/admin', require('./admin'));

module.exports = router;
