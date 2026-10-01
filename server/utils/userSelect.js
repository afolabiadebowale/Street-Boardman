// The only User fields staff screens may receive. An allow-list, not a
// deny-list: a field added to User later stays private until someone
// deliberately adds it here. `include: { user: true }` used to send whole
// rows — PIN hashes and TOTP secrets included — to any staff member with
// view access, which is enough to take over another admin's account.
// tests/integration/adminDataExposure.test.js guards every admin endpoint.
const STAFF_VISIBLE_USER_FIELDS = {
  id: true,
  role: true,
  staffRole: true,
  fullName: true,
  phone: true,
  email: true,
  status: true,
  kycTier: true,
  phoneVerifiedAt: true,
  mfaEnabledAt: true,
  lockedUntil: true,
  createdAt: true,
};

module.exports = { STAFF_VISIBLE_USER_FIELDS };
