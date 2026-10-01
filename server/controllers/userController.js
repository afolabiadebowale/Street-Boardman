const asyncHandler = require('../utils/asyncHandler');
const prisma = require('../config/db');
const { toPublicUser } = require('./authController');
const kycService = require('../services/kycService');
const { recordAuditLog } = require('../middleware/auditLog');

const getMe = asyncHandler(async (req, res) => {
  let boardmanProfile = null;
  if (req.user.role === 'BOARDMAN') {
    boardmanProfile = await prisma.boardmanProfile.findUnique({ where: { userId: req.user.id } });
  }
  res.json({ user: toPublicUser(req.user), boardmanProfile });
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

module.exports = { getMe, updateMe, verifyKyc };
