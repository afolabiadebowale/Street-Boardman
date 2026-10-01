const crypto = require('crypto');
const axios = require('axios');
const prisma = require('../config/db');
const AppError = require('../utils/appError');
const env = require('../config/env');
const walletService = require('./walletService');
const { toDecimal, round2 } = require('../utils/money');

// DEMO MODE: instantly credits the wallet with fake money. No real payment
// provider involved. This is the only deposit path available until
// APP_MODE is switched to PRODUCTION and Paystack keys are configured.
//
// Blocked outright in PRODUCTION: without this guard, anyone could mint
// fake balance via this endpoint and withdraw it as real money (TASK-001).
async function createDemoDeposit(userId, amount) {
  if (env.appMode !== 'DEMO') {
    throw new AppError('Demo deposits are disabled — this app is running in PRODUCTION mode', 403);
  }
  const amountDecimal = round2(toDecimal(amount));
  if (amountDecimal.lte(0)) throw new AppError('Deposit amount must be positive', 422);

  return prisma.$transaction(async (tx) => {
    const deposit = await tx.deposit.create({
      data: { userId, amount: amountDecimal, provider: 'DEMO', status: 'SUCCESSFUL', verifiedAt: new Date() },
    });
    const wallet = await walletService.getWalletByUserId(tx, userId);
    await walletService.applyWalletTransaction(tx, {
      walletId: wallet.id,
      type: 'DEPOSIT',
      delta: amountDecimal,
      referenceType: 'Deposit',
      referenceId: deposit.id,
      note: 'Demo wallet top-up',
      counterparty: { type: 'EXTERNAL' },
    });
    return deposit;
  });
}

// PRODUCTION MODE: asks Paystack to open a payment session. We never trust
// the browser's redirect back to us — we only mark this deposit
// SUCCESSFUL once Paystack's webhook confirms it (see verifyPaystackWebhook
// below and depositController's webhook handler).
async function initializePaystackDeposit(user, amount) {
  if (env.appMode !== 'PRODUCTION') {
    throw new AppError('Real-money deposits are disabled — this app is running in DEMO mode', 403);
  }
  const amountDecimal = round2(toDecimal(amount));
  if (amountDecimal.lte(0)) throw new AppError('Deposit amount must be positive', 422);

  const deposit = await prisma.deposit.create({
    data: { userId: user.id, amount: amountDecimal, provider: 'PAYSTACK', status: 'PENDING' },
  });

  const response = await axios.post(
    'https://api.paystack.co/transaction/initialize',
    {
      email: user.email || `${user.phone}@streetboardman.local`,
      amount: amountDecimal.times(100).toNumber(), // Paystack expects kobo
      reference: deposit.id,
      metadata: { userId: user.id, depositId: deposit.id },
    },
    { headers: { Authorization: `Bearer ${env.paystack.secretKey}` } }
  );

  await prisma.deposit.update({
    where: { id: deposit.id },
    data: { providerReference: response.data.data.reference },
  });

  return { authorizationUrl: response.data.data.authorization_url, depositId: deposit.id };
}

// Verifies the HMAC signature Paystack attaches to every webhook call so we
// know the request genuinely came from Paystack and wasn't spoofed by
// someone hitting our endpoint directly. Uses a constant-time comparison
// (TASK-004) so a timing side-channel can't help an attacker guess their
// way to a valid signature byte by byte.
function verifyPaystackSignature(rawBody, signatureHeader) {
  // Fail closed: with no secret configured, the HMAC key is an empty
  // string that anyone can compute with — every forged event would verify.
  if (!env.paystack.webhookSecret) return false;
  const hash = crypto
    .createHmac('sha512', env.paystack.webhookSecret)
    .update(rawBody)
    .digest('hex');

  if (typeof signatureHeader !== 'string' || signatureHeader.length !== hash.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(hash, 'utf8'), Buffer.from(signatureHeader, 'utf8'));
}

// Idempotent: if this deposit was already marked SUCCESSFUL (e.g. Paystack
// retried the webhook), we simply return without crediting the wallet twice
// — `reference` is the Deposit's own id, so a repeat of the same event can
// never land on a different row.
//
// Also refuses to credit if the event's amount/currency don't match what we
// initialized the deposit for (TASK-004) — the webhook is the only source
// of truth for "did this succeed", but it still has to agree with what we
// asked Paystack to charge in the first place.
async function handlePaystackChargeSuccess(reference, eventData = {}) {
  return prisma.$transaction(async (tx) => {
    const deposit = await tx.deposit.findUnique({ where: { providerReference: reference } });
    if (!deposit) throw new AppError('Unknown deposit reference', 404);
    if (deposit.status === 'SUCCESSFUL') return deposit; // already processed

    if (eventData.currency && eventData.currency !== 'NGN') {
      throw new AppError('Webhook currency does not match the deposit', 400);
    }
    if (eventData.amount !== undefined) {
      const expectedKobo = deposit.amount.times(100).toNumber();
      if (Number(eventData.amount) !== expectedKobo) {
        throw new AppError('Webhook amount does not match the deposit', 400);
      }
    }

    const updated = await tx.deposit.update({
      where: { id: deposit.id },
      data: { status: 'SUCCESSFUL', verifiedAt: new Date() },
    });
    const wallet = await walletService.getWalletByUserId(tx, deposit.userId);
    await walletService.applyWalletTransaction(tx, {
      walletId: wallet.id,
      type: 'DEPOSIT',
      delta: deposit.amount,
      referenceType: 'Deposit',
      referenceId: deposit.id,
      note: 'Paystack deposit',
      counterparty: { type: 'EXTERNAL' },
    });
    return updated;
  });
}

async function listDepositsForUser(userId) {
  return prisma.deposit.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
}

module.exports = {
  createDemoDeposit,
  initializePaystackDeposit,
  verifyPaystackSignature,
  handlePaystackChargeSuccess,
  listDepositsForUser,
};
