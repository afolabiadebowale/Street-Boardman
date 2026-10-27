const crypto = require('crypto');
const prisma = require('../config/db');
const AppError = require('../utils/appError');
const { recordAuditLog } = require('../middleware/auditLog');
const { POLICY_VERSIONS } = require('../config/constants');

// Demonstrable consent to the terms and privacy policy (NDPA, FEAT-060):
// which version each user accepted, and when. Kept apart from
// privacyService so registration (authService) can record it without a
// require cycle.
async function recordConsent(client, userId) {
  for (const [document, version] of Object.entries(POLICY_VERSIONS)) {
    // ON CONFLICT: accepting the same version twice is a no-op, and a
    // failed insert would abort the caller's transaction.
    await client.$executeRaw`
      INSERT INTO "ConsentRecord" ("id", "userId", "document", "version")
      VALUES (${crypto.randomUUID()}, ${userId}, ${document}, ${version})
      ON CONFLICT ("userId", "document", "version") DO NOTHING`;
  }
}

async function consentStatus(userId) {
  const records = await prisma.consentRecord.findMany({ where: { userId } });
  const accepted = Object.fromEntries(
    Object.keys(POLICY_VERSIONS).map((doc) => {
      const versions = records.filter((r) => r.document === doc).sort((a, b) => b.acceptedAt - a.acceptedAt);
      return [doc, versions[0] ? { version: versions[0].version, acceptedAt: versions[0].acceptedAt } : null];
    })
  );
  const required = Object.entries(POLICY_VERSIONS).some(([doc, v]) => accepted[doc]?.version !== v);
  return { current: POLICY_VERSIONS, accepted, required };
}

async function acceptCurrentPolicies(userId, versions) {
  const stale = Object.entries(POLICY_VERSIONS).filter(([doc, v]) => versions[doc] !== v);
  if (stale.length) {
    throw new AppError('Those are not the current versions of the terms and privacy policy; reload and try again', 409);
  }
  await prisma.$transaction(async (tx) => {
    await recordConsent(tx, userId);
    await recordAuditLog(
      { actorUserId: userId, action: 'POLICIES_ACCEPTED', entityType: 'User', entityId: userId, afterState: POLICY_VERSIONS },
      tx
    );
  });
  return consentStatus(userId);
}

module.exports = { recordConsent, consentStatus, acceptCurrentPolicies };
