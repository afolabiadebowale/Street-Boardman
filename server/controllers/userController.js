const asyncHandler = require('../utils/asyncHandler');
const prisma = require('../config/db');
const { toPublicUser } = require('./authController');
const kycService = require('../services/kycService');
const { recordAuditLog } = require('../middleware/auditLog');
const consentService = require('../services/consentService');
const privacyService = require('../services/privacyService');
const responsibleGambling = require('../services/responsibleGamblingService');
const { clearSessionCookies } = require('./authController');

const getMe = asyncHandler(async (req, res) => {
  let boardmanProfile = null;
  if (req.user.role === 'BOARDMAN') {
    boardmanProfile = await prisma.boardmanProfile.findUnique({ where: { userId: req.user.id } });
  }
  const consent = await consentService.consentStatus(req.user.id);
  res.json({ user: toPublicUser(req.user), boardmanProfile, consentRequired: consent.required });
});

// Name changes are audited: the insider-betting check (TASK-014) compares
// names, so a Boardman renaming themselves to dodge it has to leave a
// trail an admin can see.
const updateMe = asyncHandler(async (req, res) => {
  const { fullName, email } = req.body;
  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: req.user.id },
      data: { fullName: fullName ?? undefined, email: email ?? undefined },
    });
    if (fullName !== undefined && fullName !== req.user.fullName) {
      await recordAuditLog(
        {
          actorUserId: req.user.id,
          action: 'PROFILE_NAME_CHANGED',
          entityType: 'User',
          entityId: req.user.id,
          beforeState: { fullName: req.user.fullName },
          afterState: { fullName },
        },
        tx
      );
    }
    return user;
  });
  res.json({ user: toPublicUser(updated) });
});

const verifyKyc = asyncHandler(async (req, res) => {
  const result = await kycService.verifyBvnOrNin(req.user.id, req.body);
  res.status(201).json(result);
});

const getConsent = asyncHandler(async (req, res) => {
  res.json(await consentService.consentStatus(req.user.id));
});

const acceptPolicies = asyncHandler(async (req, res) => {
  res.json(await consentService.acceptCurrentPolicies(req.user.id, req.body));
});

// Everything we hold about the caller, as a JSON download (NDPA access).
const exportMyData = asyncHandler(async (req, res) => {
  const data = await privacyService.exportUserData(req.user.id);
  await recordAuditLog({ actorUserId: req.user.id, action: 'PERSONAL_DATA_EXPORTED', entityType: 'User', entityId: req.user.id });
  res.set('Content-Disposition', `attachment; filename="streetboardman-my-data-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(data);
});

const deleteMe = asyncHandler(async (req, res) => {
  await privacyService.deleteAccount(req.user.id, req.body.pin);
  clearSessionCookies(res);
  res.json({ deleted: true });
});

const getGamblingControls = asyncHandler(async (req, res) => {
  res.json(await responsibleGambling.getControls(req.user));
});

const setGamblingLimit = asyncHandler(async (req, res) => {
  res.json({ limit: await responsibleGambling.setLimit(req.user.id, req.body) });
});

const selfExclude = asyncHandler(async (req, res) => {
  res.json({ selfExclusion: await responsibleGambling.selfExclude(req.user.id, req.body.period) });
});

const coolOff = asyncHandler(async (req, res) => {
  res.json({ coolingOff: await responsibleGambling.coolOff(req.user.id) });
});

module.exports = {
  getGamblingControls,
  setGamblingLimit,
  selfExclude,
  coolOff,
  getConsent,
  acceptPolicies,
  exportMyData,
  deleteMe, getMe, updateMe, verifyKyc };
