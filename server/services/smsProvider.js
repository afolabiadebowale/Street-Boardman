const AppError = require('../utils/appError');
const env = require('../config/env');
const logger = require('../utils/logger');

// Stands in for a real SMS gateway (Termii or Africa's Talking, per the
// implementation plan) until one is wired up with real credentials
// (TASK-025's scope note). Same pattern as withdrawalService.transferFunds
// (TASK-003): throws in PRODUCTION rather than pretending to send
// something, so a misconfigured deployment fails loudly instead of
// silently never delivering an OTP. DEMO mode logs the code instead of
// sending it — good enough for local development and for the pilot's
// DEMO-money phase.
async function sendOtp(phone, code) {
  if (env.appMode === 'PRODUCTION') {
    throw new AppError(
      'No SMS provider is configured (see FEAT-014) — cannot send a real OTP',
      501
    );
  }
  // Code only ever reaches logs in DEMO mode — PRODUCTION throws above.
  // Values go in structured fields, never interpolated into the message.
  logger.info({ event: 'demo_sms_otp', phone, code }, '[DEMO SMS] OTP issued');
  return { success: true, provider: 'demo-console' };
}

module.exports = { sendOtp };
