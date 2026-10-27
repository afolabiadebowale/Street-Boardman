const { z } = require('zod');

// zod 4 reports a missing field as "Invalid input: expected string,
// received undefined". These messages go straight to users, so keep
// zod 3's plain "Required" for that case; every other message is either
// set per field below or zod's default.
z.config({
  customError: (issue) => (issue.input === undefined ? 'Required' : undefined),
});

const phone = z.string().min(10, 'Enter a valid phone number').max(15);
const pin = z.string().min(4, 'PIN/password must be at least 4 characters');

// zod's .url() accepts javascript: and data: URLs. These links are stored
// and will be shown to admins reviewing KYC documents and result evidence,
// where a javascript: link is stored XSS against the most privileged
// accounts. https only (ASVS 5.1.3).
const httpsUrl = z
  .string()
  .max(2048)
  .url()
  .refine((value) => value.startsWith('https://'), 'Links must start with https://');

// Ticking "I accept the terms and privacy policy" (FEAT-060). Optional
// until the sign-up form sends it; see REQUIRE_POLICY_CONSENT.
const acceptPolicies = z.literal(true).optional();

const registerBetterSchema = z.object({
  fullName: z.string().min(2, 'Full name is required'),
  phone,
  pin,
  acceptPolicies,
});

const registerBoardmanSchema = z.object({
  fullName: z.string().min(2, 'Full name is required'),
  phone,
  pin,
  businessLocation: z.string().min(2, 'Location is required'),
  kycDocumentUrl: httpsUrl.optional(),
  acceptPolicies,
});

// Responsible gambling (A2). amount null removes the limit.
const setGamblingLimitSchema = z.object({
  kind: z.enum(['DEPOSIT', 'STAKE']),
  period: z.enum(['DAY', 'WEEK', 'MONTH']),
  amount: z.number().positive().max(100_000_000).nullable(),
});

// Exclusion can't be undone, so the client must send confirm: true.
const selfExclusionSchema = z.object({
  period: z.enum(['7d', '30d', '6m', 'permanent']),
  confirm: z.literal(true, { error: 'Confirm that you understand this cannot be undone' }),
});

const acceptPoliciesSchema = z.object({
  TERMS: z.string().min(1),
  PRIVACY: z.string().min(1),
});

// Typing DELETE as well as the PIN: erasure can't be undone.
const deleteAccountSchema = z.object({
  pin: z.string().min(1, 'Enter your PIN'),
  confirm: z.literal('DELETE', { error: 'Type DELETE to confirm' }),
});

const loginSchema = z.object({ phone, pin });

// Role-specific rules (12+ for staff) are applied in staffSecurityService;
// this only bounds the input.
const changePasswordSchema = z.object({
  currentPassword: z.string({ error: 'Enter your current password' }).min(1, 'Enter your current password'),
  newPassword: z.string({ error: 'Enter a new password' }).min(4, 'Too short').max(128),
});

const updateMeSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required').max(100).optional(),
  email: z.string().trim().email('Enter a valid email').max(254).optional(),
});

const otpRequestSchema = z.object({
  phone,
  purpose: z.enum(['SIGNUP', 'BANK_ACCOUNT_CHANGE']),
});

const otpVerifySchema = z.object({
  phone,
  purpose: z.enum(['SIGNUP', 'BANK_ACCOUNT_CHANGE']),
  code: z.string().length(6, 'Enter the 6-digit code'),
});

const mfaVerifySchema = z.object({
  mfaToken: z.string().min(1),
  code: z.string().length(6, 'Enter the 6-digit code'),
});

const mfaCodeSchema = z.object({
  code: z.string().length(6, 'Enter the 6-digit code'),
});

const setStaffRoleSchema = z.object({
  staffRole: z.enum(['SUPPORT', 'FINANCE', 'COMPLIANCE', 'SUPER_ADMIN']).nullable(),
});

const kycVerifySchema = z.object({
  idType: z.enum(['BVN', 'NIN']),
  value: z.string().length(11, 'BVN/NIN must be 11 digits').regex(/^\d+$/, 'Digits only'),
});

const demoDepositSchema = z.object({ amount: z.number().positive() });

const paystackInitializeSchema = z.object({ amount: z.number().positive() });

const withdrawalSchema = z.object({
  amount: z.number().positive(),
  pin: z
    .string({ error: 'Enter your PIN to confirm this withdrawal' })
    .min(1, 'Enter your PIN to confirm this withdrawal'),
  destination: z.object({
    bankName: z.string().min(2),
    accountNumber: z.string().min(6),
    accountName: z.string().min(2),
    // Paystack bank code (e.g. "058"); required in PRODUCTION (TASK-021).
    bankCode: z.string().regex(/^\d{3,6}$/, 'Choose a valid bank').optional(),
  }),
});

const createCompetitionSchema = z.object({
  title: z.string().min(3),
  description: z.string().optional(),
  category: z.enum(['FOOTBALL', 'SNOOKER', 'FIGHT', 'TABLE_GAME', 'OTHER']),
  bettingDeadline: z.string().datetime().or(z.string()),
  participants: z.array(z.string()).optional(),
  options: z.array(z.string()).min(2, 'At least two betting options are required'),
});

// Only these fields are editable (FEAT-039); .strict() turns an attempt to
// change options or commission rates into a clear 422.
const updateCompetitionSchema = z
  .object({
    title: z.string().trim().min(3).max(120).optional(),
    description: z.string().max(1000).optional(),
    bettingDeadline: z.string().datetime().optional(),
  })
  .strict();

const cancelCompetitionSchema = z.object({
  reason: z.string().trim().min(5, 'Tell bettors why the competition is cancelled').max(500),
});

const adjustmentRequestSchema = z.object({
  userId: z.string().min(1),
  amount: z.number().refine((n) => n !== 0, 'Amount cannot be zero'),
  reason: z.string().trim().min(10, 'Explain the adjustment (at least 10 characters)').max(500),
});

const adjustmentApproveSchema = z.object({ note: z.string().trim().max(500).optional() });

const adjustmentRejectSchema = z.object({
  note: z.string().trim().min(5, 'Say why the adjustment is rejected').max(500),
});

// Public browse query (FEAT-043); strings from the URL are coerced.
const browseCompetitionsQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  category: z.enum(['FOOTBALL', 'SNOOKER', 'FIGHT', 'TABLE_GAME', 'OTHER']).optional(),
  location: z.string().trim().min(2).max(100).optional(),
  closingWithinHours: z.coerce.number().positive().max(24 * 30).optional(),
  boardmanProfileId: z.string().min(1).max(64).optional(),
  sort: z.enum(['deadline', 'pool', 'newest']).default('deadline'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

const placeBetSchema = z.object({
  betOptionId: z.string().min(1),
  stake: z.number().positive(),
});

const submitResultSchema = z.object({
  winningOptionId: z.string().min(1),
  finalScore: z.string().optional(),
  evidenceUrls: z.array(httpsUrl).max(10).optional(),
  // Photos uploaded through POST /api/uploads/evidence (FEAT-042).
  evidenceUploadIds: z.array(z.string().uuid()).max(10).optional(),
  notes: z.string().optional(),
});

const raiseDisputeSchema = z.object({ reason: z.string().min(5, 'Please explain the issue') });

const resolveDisputeSchema = z.object({
  action: z.enum(['CONFIRM', 'CANCEL']),
  winningOptionId: z.string().optional(),
});

const updateSettingsSchema = z.object({
  boardmanCommissionRate: z.number().min(0).max(1).optional(),
  platformCommissionRate: z.number().min(0).max(1).optional(),
  resultConfirmationWindowHours: z.number().min(0).optional(),
});

module.exports = {
  registerBetterSchema,
  registerBoardmanSchema,
  acceptPoliciesSchema,
  deleteAccountSchema,
  setGamblingLimitSchema,
  selfExclusionSchema,
  loginSchema,
  updateMeSchema,
  changePasswordSchema,
  mfaVerifySchema,
  mfaCodeSchema,
  otpRequestSchema,
  otpVerifySchema,
  kycVerifySchema,
  setStaffRoleSchema,
  demoDepositSchema,
  paystackInitializeSchema,
  withdrawalSchema,
  createCompetitionSchema,
  browseCompetitionsQuery,
  adjustmentRequestSchema,
  adjustmentApproveSchema,
  adjustmentRejectSchema,
  updateCompetitionSchema,
  cancelCompetitionSchema,
  placeBetSchema,
  submitResultSchema,
  raiseDisputeSchema,
  resolveDisputeSchema,
  updateSettingsSchema,
};
