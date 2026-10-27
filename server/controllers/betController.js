const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');
const bettingService = require('../services/bettingService');

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

// Optional Idempotency-Key header (e.g. a UUID the app generates once per
// bet slip): a repeat returns the original bet with 200 instead of 201.
const placeBet = asyncHandler(async (req, res) => {
  const idempotencyKey = req.get('Idempotency-Key');
  if (idempotencyKey !== undefined && !IDEMPOTENCY_KEY.test(idempotencyKey)) {
    throw new AppError('Idempotency-Key must be 8-64 letters, digits, - or _', 422);
  }
  const { replayed, ...bet } = await bettingService.placeBet({
    betterId: req.user.id,
    betOptionId: req.body.betOptionId,
    stake: req.body.stake,
    idempotencyKey,
    hasGamblingLimits: req.user.hasGamblingLimits,
  });
  if (replayed) res.set('Idempotent-Replayed', 'true');
  res.status(replayed ? 200 : 201).json({ bet });
});

const listMyBets = asyncHandler(async (req, res) => {
  const bets = await bettingService.listBetsForBetter(req.user.id);
  res.json({ bets });
});

const getTicket = asyncHandler(async (req, res) => {
  const bet = await bettingService.getBetByCode(req.params.betCode, req.user.id);
  res.json({ bet });
});

const shareTicket = asyncHandler(async (req, res) => {
  res.json(await bettingService.shareTicket(req.params.betCode, req.user.id));
});

const getSharedTicket = asyncHandler(async (req, res) => {
  res.json({ ticket: await bettingService.getSharedTicket(req.params.token) });
});

module.exports = {
  shareTicket,
  getSharedTicket, placeBet, listMyBets, getTicket };
