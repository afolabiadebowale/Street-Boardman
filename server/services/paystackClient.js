const axios = require('axios');
const env = require('../config/env');

// The Paystack endpoints payouts need (TASK-021/024). Every call returns
// Paystack's `data` or throws a PaystackError that says whether Paystack
// definitely did NOT act on the request (`rejected`: it answered 4xx) or
// the outcome is unknown (timeout, network failure, 5xx). With money
// moving, those two cases have to be handled differently: a rejected
// transfer can simply be retried later, an unknown one must be confirmed
// before anything else happens.
const http = axios.create({ baseURL: 'https://api.paystack.co', timeout: 15000 });

class PaystackError extends Error {
  constructor(message, { rejected, status }) {
    super(message);
    this.name = 'PaystackError';
    this.rejected = rejected;
    this.status = status;
  }
}

async function call(method, path, data) {
  try {
    const response = await http.request({
      method,
      url: path,
      data,
      headers: { Authorization: `Bearer ${env.paystack.secretKey}` },
    });
    return response.data.data;
  } catch (err) {
    const status = err.response?.status;
    const message = err.response?.data?.message || err.message;
    throw new PaystackError(`Paystack ${method} ${path} failed: ${message}`, {
      rejected: status !== undefined && status < 500,
      status,
    });
  }
}

// Paystack validates the account against the bank when creating the
// recipient, so a mistyped account number fails here, before any transfer.
function createTransferRecipient({ name, accountNumber, bankCode }) {
  return call('POST', '/transferrecipient', {
    type: 'nuban',
    name,
    account_number: accountNumber,
    bank_code: bankCode,
    currency: 'NGN',
  });
}

// `reference` is our idempotency key: Paystack refuses a second transfer
// with the same reference.
function initiateTransfer({ amountKobo, recipientCode, reference, reason }) {
  return call('POST', '/transfer', {
    source: 'balance',
    amount: amountKobo,
    recipient: recipientCode,
    reference,
    reason,
    currency: 'NGN',
  });
}

function verifyTransfer(reference) {
  return call('GET', `/transfer/verify/${encodeURIComponent(reference)}`);
}

async function getNgnBalanceKobo() {
  const balances = await call('GET', '/balance');
  const ngn = (balances || []).find((b) => b.currency === 'NGN');
  return ngn ? Number(ngn.balance) : 0;
}

module.exports = {
  PaystackError,
  createTransferRecipient,
  initiateTransfer,
  verifyTransfer,
  getNgnBalanceKobo,
};
