const asyncHandler = require('../utils/asyncHandler');
const withdrawalService = require('../services/withdrawalService');
const authService = require('../services/authService');

// The PIN is re-checked here, at the HTTP boundary, because that's where
// a hijacked session arrives (TASK-036 O3). The destination account is
// part of this same request, so this also covers "change where my money
// goes" — there's no separate bank-details endpoint.
const requestWithdrawal = asyncHandler(async (req, res) => {
  await authService.verifyPinStepUp(req.user.id, req.body.pin);
  const withdrawal = await withdrawalService.requestWithdrawal(req.user.id, req.body.amount, req.body.destination);
  res.status(201).json({ withdrawal });
});

const listMyWithdrawals = asyncHandler(async (req, res) => {
  const withdrawals = await withdrawalService.listWithdrawalsForUser(req.user.id);
  res.json({ withdrawals });
});

const adminProcessWithdrawal = asyncHandler(async (req, res) => {
  const withdrawal = await withdrawalService.processWithdrawal(req.params.id, req.user.id);
  res.json({ withdrawal });
});

const adminRejectWithdrawal = asyncHandler(async (req, res) => {
  const withdrawal = await withdrawalService.rejectWithdrawal(req.params.id, req.user.id, req.body.reason);
  res.json({ withdrawal });
});

module.exports = { requestWithdrawal, listMyWithdrawals, adminProcessWithdrawal, adminRejectWithdrawal };
