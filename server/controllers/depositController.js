const asyncHandler = require('../utils/asyncHandler');
const depositService = require('../services/depositService');
const withdrawalService = require('../services/withdrawalService');
const AppError = require('../utils/appError');

const createDemoDeposit = asyncHandler(async (req, res) => {
  const deposit = await depositService.createDemoDeposit(req.user.id, req.body.amount);
  res.status(201).json({ deposit });
});

const initializePaystack = asyncHandler(async (req, res) => {
  const result = await depositService.initializePaystackDeposit(req.user, req.body.amount);
  res.status(201).json(result);
});

// Paystack calls this directly — there is no logged-in session here, so
// trust comes only from the verified HMAC signature, never from req.user.
// req.body arrives as a raw Buffer (see app.js routing for this path),
// which is required because the signature is computed over the exact raw
// bytes Paystack sent — a re-serialized JSON object would hash differently.
const paystackWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  const isValid = depositService.verifyPaystackSignature(req.body, signature);
  if (!isValid) throw new AppError('Invalid webhook signature', 401);

  const event = JSON.parse(req.body.toString('utf8'));
  if (event.event === 'charge.success') {
    await depositService.handlePaystackChargeSuccess(event.data.reference, {
      amount: event.data.amount,
      currency: event.data.currency,
    });
  } else if (event.event?.startsWith('transfer.')) {
    // One webhook URL per Paystack account, so payouts arrive here too.
    await withdrawalService.handlePaystackTransferEvent(event.event, event.data);
  }
  res.sendStatus(200);
});

const listMyDeposits = asyncHandler(async (req, res) => {
  const deposits = await depositService.listDepositsForUser(req.user.id);
  res.json({ deposits });
});

module.exports = { createDemoDeposit, initializePaystack, paystackWebhook, listMyDeposits };
