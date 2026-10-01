const env = require('../config/env');
const AppError = require('../utils/appError');

// Staff accounts can move money and change other users, so they get a
// stricter bar than bettors' 4-digit PINs (ASVS 2.1.1 / 4.3.1):
// MFA on, and a password of at least 12 characters.
const STAFF_MIN_PASSWORD_LENGTH = 12;
const MIN_PIN_LENGTH = 4;

function isEnforced(now = new Date()) {
  const from = env.staffSecurityEnforcedFrom;
  return Boolean(from) && now >= from;
}

function isWeakStaffPassword(user, plainPassword) {
  return user.role === 'ADMIN' && plainPassword.length < STAFF_MIN_PASSWORD_LENGTH;
}

// What the client needs to show a banner, or send the admin to
// /admin/security once the gate is live. Null for non-staff.
function statusFor(user) {
  if (user.role !== 'ADMIN') return null;
  return {
    enforced: isEnforced(),
    enforcedFrom: env.staffSecurityEnforcedFrom ? env.staffSecurityEnforcedFrom.toISOString() : null,
    mfaRequired: !user.mfaEnabledAt,
    passwordChangeRequired: Boolean(user.mustChangePassword),
  };
}

function validateNewPassword(user, newPassword) {
  if (user.role === 'ADMIN') {
    if (newPassword.length < STAFF_MIN_PASSWORD_LENGTH) {
      throw new AppError(`Staff passwords must be at least ${STAFF_MIN_PASSWORD_LENGTH} characters`, 422);
    }
    if (user.phone && newPassword.includes(user.phone)) {
      throw new AppError('Your password must not contain your phone number', 422);
    }
  } else if (newPassword.length < MIN_PIN_LENGTH) {
    throw new AppError(`Your PIN must be at least ${MIN_PIN_LENGTH} characters`, 422);
  }
}

// Mounted on the admin router after requireRole('ADMIN'). Account-security
// endpoints (/api/auth/mfa/*, /api/auth/password) live outside that
// router, so a gated admin can always fix their own account.
function requireStaffSecurity(req, res, next) {
  if (!isEnforced()) return next();
  if (!req.user.mfaEnabledAt) {
    throw new AppError('Set up two-factor authentication before using admin tools', 403, 'MFA_REQUIRED');
  }
  if (req.user.mustChangePassword) {
    throw new AppError(
      `Change your password to one of at least ${STAFF_MIN_PASSWORD_LENGTH} characters before using admin tools`,
      403,
      'PASSWORD_CHANGE_REQUIRED'
    );
  }
  next();
}

module.exports = {
  STAFF_MIN_PASSWORD_LENGTH,
  isEnforced,
  isWeakStaffPassword,
  statusFor,
  validateNewPassword,
  requireStaffSecurity,
};
