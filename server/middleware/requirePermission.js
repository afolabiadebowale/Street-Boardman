const AppError = require('../utils/appError');
const { staffRoleHasPermission } = require('../config/staffPermissions');

// Usage: requirePermission('MANAGE_WITHDRAWALS') as route middleware,
// after requireAuth + requireRole('ADMIN') (TASK-030). Being role=ADMIN
// only means "can reach admin routes at all" — this is what actually
// authorises a specific action, based on the account's staffRole. An
// ADMIN account with no staffRole set (the default) can authenticate but
// do nothing, until someone with MANAGE_STAFF grants it one.
function requirePermission(permission) {
  return function (req, res, next) {
    if (!req.user) throw new AppError('Not authenticated', 401);
    if (!staffRoleHasPermission(req.user.staffRole, permission)) {
      throw new AppError('Your staff role does not permit this action', 403);
    }
    next();
  };
}

module.exports = requirePermission;
