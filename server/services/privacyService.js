const crypto = require('crypto');
const prisma = require('../config/db');
const AppError = require('../utils/appError');
const password = require('../utils/password');
const authService = require('./authService');
const { recordAuditLog } = require('../middleware/auditLog');
const { toDecimal } = require('../utils/money');

// Data-protection rights under Nigeria's NDPA (FEAT-060): demonstrable
// consent, a copy of your data, and erasure.

// ---- Export (right of access) ----------------------------------------------

// Fraud signals stay out of the export: telling someone they were flagged
// would help them evade it (an NDPA exemption for crime prevention).
const FRAUD_SIGNAL = /SUSPECTED|REUSE|FLAG/;

async function exportUserData(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { boardmanProfile: true, wallet: true },
  });
  if (!user) throw new AppError('User not found', 404);

  const [transactions, bets, deposits, withdrawals, kyc, notifications, consents, activity, competitions] = await Promise.all([
    user.wallet
      ? prisma.walletTransaction.findMany({
          where: { walletId: user.wallet.id },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true, type: true, amount: true, balanceAfter: true, note: true },
        })
      : [],
    prisma.bet.findMany({
      where: { betterId: userId },
      orderBy: { placedAt: 'asc' },
      select: {
        betCode: true, stake: true, potentialPayout: true, status: true, placedAt: true,
        betOption: { select: { label: true, competition: { select: { title: true } } } },
      },
    }),
    prisma.deposit.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, amount: true, provider: true, status: true, verifiedAt: true },
    }),
    prisma.withdrawal.findMany({
      where: { userId },
      orderBy: { requestedAt: 'asc' },
      select: { requestedAt: true, amount: true, destination: true, status: true, processedAt: true },
    }),
    // The BVN/NIN itself is never stored, only a hash, which is useless to
    // the user and not included.
    prisma.kycVerification.findMany({
      where: { userId },
      select: { idType: true, matched: true, dateOfBirth: true, provider: true, verifiedAt: true },
    }),
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, type: true, message: true, readAt: true },
    }),
    prisma.consentRecord.findMany({ where: { userId }, select: { document: true, version: true, acceptedAt: true } }),
    prisma.auditLog.findMany({
      where: { actorUserId: userId },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, action: true, entityType: true },
    }),
    user.boardmanProfile
      ? prisma.competition.findMany({
          where: { boardmanProfileId: user.boardmanProfile.id },
          select: { title: true, category: true, status: true, createdAt: true },
        })
      : [],
  ]);

  return {
    exportedAt: new Date().toISOString(),
    profile: {
      fullName: user.fullName,
      phone: user.phone,
      email: user.email,
      role: user.role,
      status: user.status,
      kycTier: user.kycTier,
      phoneVerifiedAt: user.phoneVerifiedAt,
      mfaEnabled: Boolean(user.mfaEnabledAt),
      createdAt: user.createdAt,
    },
    boardman: user.boardmanProfile
      ? {
          businessLocation: user.boardmanProfile.businessLocation,
          kycDocumentUrl: user.boardmanProfile.kycDocumentUrl,
          approvalStatus: user.boardmanProfile.approvalStatus,
          approvedAt: user.boardmanProfile.approvedAt,
          competitions,
        }
      : null,
    wallet: user.wallet ? { balance: user.wallet.balance, currency: user.wallet.currency, transactions } : null,
    bets: bets.map(({ betOption, ...b }) => ({ ...b, option: betOption.label, competition: betOption.competition.title })),
    deposits,
    withdrawals,
    identityChecks: kyc,
    notifications,
    consents,
    accountActivity: activity.filter((a) => !FRAUD_SIGNAL.test(a.action)),
  };
}

// ---- Erasure ---------------------------------------------------------------

const FINAL_COMPETITION = ['COMPLETED', 'CANCELLED_REFUNDED'];

// Anonymises rather than deletes: wallet history, bets, deposits and
// withdrawals are financial records the business must keep (audit, AML),
// and the ledger must keep balancing. What identifies the person goes:
// name, phone, email, device, MFA, notification texts, Boardman details.
// Refused while money or obligations are still attached to the account,
// so nothing is stranded.
async function deleteAccount(userId, pin) {
  await authService.verifyPinStepUp(userId, pin);
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { boardmanProfile: true } });
  if (user.role === 'ADMIN') throw new AppError('Staff accounts are closed by a super admin, not self-service', 403);
  const unusable = await password.hash(crypto.randomBytes(32).toString('hex'));

  await prisma.$transaction(async (tx) => {
    // Lock the wallet so no credit or stake can land while we check.
    const [wallet] = await tx.$queryRaw`SELECT balance FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE`;
    if (wallet && toDecimal(wallet.balance).gt(0)) {
      throw new AppError('Withdraw your remaining balance before deleting your account', 409);
    }
    const [openBets, pendingWithdrawals, pendingDeposits, liveCompetitions] = await Promise.all([
      tx.bet.count({ where: { betterId: userId, status: 'OPEN' } }),
      tx.withdrawal.count({ where: { userId, status: { in: ['PENDING', 'PROCESSING'] } } }),
      tx.deposit.count({ where: { userId, status: 'PENDING', createdAt: { gt: new Date(Date.now() - 24 * 3600 * 1000) } } }),
      user.boardmanProfile
        ? tx.competition.count({ where: { boardmanProfileId: user.boardmanProfile.id, status: { notIn: FINAL_COMPETITION } } })
        : 0,
    ]);
    if (openBets) throw new AppError('You still have open bets; wait for them to settle', 409);
    if (pendingWithdrawals) throw new AppError('A withdrawal is still being processed', 409);
    if (pendingDeposits) throw new AppError('A deposit is still being processed', 409);
    if (liveCompetitions) throw new AppError('Finish or cancel your competitions first', 409);

    const claim = await tx.user.updateMany({
      where: { id: userId, deletedAt: null },
      data: {
        fullName: 'Deleted user',
        phone: `deleted-${userId}`,
        email: null,
        passwordHash: unusable,
        pinHash: null,
        deviceFingerprint: null,
        mfaSecret: null,
        mfaEnabledAt: null,
        mfaLastTimeStep: null,
        phoneVerifiedAt: null,
        status: 'SUSPENDED',
        deletedAt: new Date(),
        tokenVersion: { increment: 1 }, // ends every open session
      },
    });
    if (claim.count === 0) throw new AppError('This account is already deleted', 409);
    if (user.boardmanProfile) {
      await tx.boardmanProfile.update({
        where: { id: user.boardmanProfile.id },
        data: { businessLocation: 'Removed', kycDocumentUrl: null },
      });
    }
    await tx.notification.deleteMany({ where: { userId } });
    await tx.otpCode.deleteMany({ where: { phone: user.phone } });
    await tx.kycVerification.updateMany({ where: { userId }, data: { dateOfBirth: null } });
    await recordAuditLog(
      { actorUserId: userId, action: 'ACCOUNT_DELETED', entityType: 'User', entityId: userId, beforeState: { role: user.role } },
      tx
    );
  });
}

// ---- Retention (worker, daily) ---------------------------------------------

const OTP_RETENTION_DAYS = 7;
const NOTIFICATION_RETENTION_DAYS = 180;

// Keep personal data no longer than needed: used/expired login codes, and
// old notification texts (already delivered, already in the user's inbox
// for six months).
async function runRetention({ now = new Date() } = {}) {
  const day = 24 * 3600 * 1000;
  const otp = await prisma.otpCode.deleteMany({ where: { expiresAt: { lt: new Date(now - OTP_RETENTION_DAYS * day) } } });
  const notifications = await prisma.notification.deleteMany({
    where: { status: { not: 'PENDING' }, createdAt: { lt: new Date(now - NOTIFICATION_RETENTION_DAYS * day) } },
  });
  return { otpCodesDeleted: otp.count, notificationsDeleted: notifications.count };
}

module.exports = {
  exportUserData,
  deleteAccount,
  runRetention,
  OTP_RETENTION_DAYS,
  NOTIFICATION_RETENTION_DAYS,
};
