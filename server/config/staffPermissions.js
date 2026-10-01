// Maps each staff sub-role (TASK-030) to what it can actually do. Named
// after real job functions (report §9's suggested staff roles), not raw
// per-route flags — a real organisation hires a "finance" person, not a
// holder of eleven individually-granted permissions.
const PERMISSIONS = {
  MANAGE_BOARDMEN: 'MANAGE_BOARDMEN',
  MANAGE_USERS: 'MANAGE_USERS',
  MANAGE_DISPUTES: 'MANAGE_DISPUTES',
  MANAGE_SETTINGS: 'MANAGE_SETTINGS',
  MANAGE_WITHDRAWALS: 'MANAGE_WITHDRAWALS',
  VIEW_LEDGER: 'VIEW_LEDGER',
  VIEW_AUDIT_LOGS: 'VIEW_AUDIT_LOGS',
  VIEW_ONLY: 'VIEW_ONLY', // overview/competitions/bets listings — low-risk read access
  MANAGE_STAFF: 'MANAGE_STAFF', // grant/revoke other staff's roles
};

const ROLE_PERMISSIONS = {
  SUPPORT: [PERMISSIONS.VIEW_ONLY],
  FINANCE: [PERMISSIONS.VIEW_ONLY, PERMISSIONS.MANAGE_WITHDRAWALS, PERMISSIONS.VIEW_LEDGER, PERMISSIONS.MANAGE_SETTINGS],
  COMPLIANCE: [
    PERMISSIONS.VIEW_ONLY,
    PERMISSIONS.MANAGE_BOARDMEN,
    PERMISSIONS.MANAGE_USERS,
    PERMISSIONS.MANAGE_DISPUTES,
    PERMISSIONS.VIEW_AUDIT_LOGS,
  ],
  SUPER_ADMIN: Object.values(PERMISSIONS), // everything, including MANAGE_STAFF
};

function staffRoleHasPermission(staffRole, permission) {
  if (!staffRole) return false;
  return (ROLE_PERMISSIONS[staffRole] || []).includes(permission);
}

module.exports = { PERMISSIONS, ROLE_PERMISSIONS, staffRoleHasPermission };
