const crypto = require('crypto');
const { recordAuditLog } = require('../middleware/auditLog');

// A deliberately weak signal (TASK-029): IP address + User-Agent, hashed
// together. This is NOT commercial-grade device fingerprinting (no canvas/
// WebGL/font enumeration, no FingerprintJS) — it's what's available
// without a new paid third-party service, and it's used only to flag
// accounts for review, never to block registration outright. Real
// device fingerprinting is a Phase 2+ upgrade if the flag rate here turns
// out to be too noisy or too easily evaded.
function computeFingerprint(req) {
  const ip = req.ip || 'unknown-ip';
  const userAgent = req.headers['user-agent'] || 'unknown-agent';
  return crypto.createHash('sha256').update(`${ip}::${userAgent}`).digest('hex');
}

// Called right after a new user is created. Flags (audit-logs) rather
// than blocks if the same fingerprint already exists on another account —
// shared wifi, a family signing up from one phone, or a reinstalled app
// can all trigger a false positive, so this is a review signal, not a
// registration gate. Feeds the same review queue as TASK-014's
// insider-betting heuristic.
async function flagIfDeviceReused(tx, { newUserId, fingerprint }) {
  if (!fingerprint) return;

  const existing = await tx.user.findFirst({
    where: { deviceFingerprint: fingerprint, id: { not: newUserId } },
    select: { id: true },
  });
  if (!existing) return;

  await recordAuditLog(
    {
      actorUserId: newUserId,
      action: 'DEVICE_FINGERPRINT_REUSED',
      entityType: 'User',
      entityId: newUserId,
      beforeState: null,
      afterState: { matchedExistingUserId: existing.id },
    },
    tx
  );
}

module.exports = { computeFingerprint, flagIfDeviceReused };
