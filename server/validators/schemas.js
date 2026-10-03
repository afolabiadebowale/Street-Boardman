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

const registerBetterSchema = z.object({
  fullName: z.string().min(2, 'Full name is required'),
  phone,
  pin,
});

const registerBoardmanSchema = z.object({
  fullName: z.string().min(2, 'Full name is required'),
  phone,
  pin,
  businessLocation: z.string().min(2, 'Location is required'),
  kycDocumentUrl: httpsUrl.optional(),
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

const placeBetSchema = z.object({
  betOptionId: z.string().min(1),
  stake: z.number().positive(),
});

const submitResultSchema = z.object({
  winningOptionId: z.string().min(1),
  finalScore: z.string().optional(),
  evidenceUrls: z.array(httpsUrl).max(10).optional(),
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
  placeBetSchema,
  submitResultSchema,
  raiseDisputeSchema,
  resolveDisputeSchema,
  updateSettingsSchema,
};
