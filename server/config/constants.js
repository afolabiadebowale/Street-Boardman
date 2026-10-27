module.exports = {
  ROLES: {
    BETTER: 'BETTER',
    BOARDMAN: 'BOARDMAN',
    ADMIN: 'ADMIN',
  },
  SETTING_KEYS: {
    BOARDMAN_COMMISSION_RATE: 'boardmanCommissionRate',
    PLATFORM_COMMISSION_RATE: 'platformCommissionRate',
    RESULT_CONFIRMATION_WINDOW_HOURS: 'resultConfirmationWindowHours',
  },
  // Current versions of the documents users must accept (FEAT-060).
  // Bumping one makes every user's consent "required" again.
  POLICY_VERSIONS: {
    TERMS: '2026-10-27',
    PRIVACY: '2026-10-27',
  },
  COOKIE_NAMES: {
    ACCESS: 'sb_access',
    REFRESH: 'sb_refresh',
  },
};
