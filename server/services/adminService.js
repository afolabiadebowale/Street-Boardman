const prisma = require('../config/db');
const AppError = require('../utils/appError');
const { recordAuditLog } = require('../middleware/auditLog');
const { STAFF_VISIBLE_USER_FIELDS } = require('../utils/userSelect');

const staffUser = { select: STAFF_VISIBLE_USER_FIELDS };

async function listPendingBoardmen() {
  return prisma.boardmanProfile.findMany({
    where: { approvalStatus: 'PENDING_APPROVAL' },
    include: { user: staffUser },
    orderBy: { createdAt: 'asc' },
  });
}

async function listAllBoardmen() {
  return prisma.boardmanProfile.findMany({ include: { user: staffUser }, orderBy: { createdAt: 'desc' } });
}

async function approveBoardman(boardmanProfileId, adminUserId) {
  const before = await prisma.boardmanProfile.findUnique({ where: { id: boardmanProfileId } });
  if (!before) throw new AppError('Boardman not found', 404);

  const updated = await prisma.boardmanProfile.update({
    where: { id: boardmanProfileId },
    data: { approvalStatus: 'APPROVED', approvedByAdminId: adminUserId, approvedAt: new Date() },
  });
  await recordAuditLog({
    actorUserId: adminUserId,
    action: 'BOARDMAN_APPROVED',
    entityType: 'BoardmanProfile',
    entityId: boardmanProfileId,
    beforeState: { approvalStatus: before.approvalStatus },
    afterState: { approvalStatus: 'APPROVED' },
  });
  return updated;
}

async function rejectBoardman(boardmanProfileId, adminUserId, reason) {
  const before = await prisma.boardmanProfile.findUnique({ where: { id: boardmanProfileId } });
  if (!before) throw new AppError('Boardman not found', 404);

  const updated = await prisma.boardmanProfile.update({
    where: { id: boardmanProfileId },
    data: { approvalStatus: 'REJECTED' },
  });
  await recordAuditLog({
    actorUserId: adminUserId,
    action: 'BOARDMAN_REJECTED',
    entityType: 'BoardmanProfile',
    entityId: boardmanProfileId,
    beforeState: { approvalStatus: before.approvalStatus },
    afterState: { approvalStatus: 'REJECTED', reason },
  });
  return updated;
}

async function suspendBoardman(boardmanProfileId, adminUserId) {
  return prisma.boardmanProfile.update({
    where: { id: boardmanProfileId },
    data: { approvalStatus: 'SUSPENDED' },
  }).then(async (updated) => {
    await recordAuditLog({
      actorUserId: adminUserId,
      action: 'BOARDMAN_SUSPENDED',
      entityType: 'BoardmanProfile',
      entityId: boardmanProfileId,
    });
    return updated;
  });
}

async function suspendUser(userId, adminUserId) {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { status: 'SUSPENDED' },
    select: STAFF_VISIBLE_USER_FIELDS,
  });
  await recordAuditLog({ actorUserId: adminUserId, action: 'USER_SUSPENDED', entityType: 'User', entityId: userId });
  return updated;
}

async function reactivateUser(userId, adminUserId) {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { status: 'ACTIVE' },
    select: STAFF_VISIBLE_USER_FIELDS,
  });
  await recordAuditLog({ actorUserId: adminUserId, action: 'USER_REACTIVATED', entityType: 'User', entityId: userId });
  return updated;
}

async function listUsers() {
  return prisma.user.findMany({ orderBy: { createdAt: 'desc' }, select: STAFF_VISIBLE_USER_FIELDS });
}

async function getFinancialLedger({ take = 100 } = {}) {
  return prisma.walletTransaction.findMany({
    orderBy: { createdAt: 'desc' },
    take,
    include: { wallet: { include: { user: staffUser } } },
  });
}

// Grants or revokes a staff sub-role (TASK-030). Gated by MANAGE_STAFF at
// the route layer — only a SUPER_ADMIN can reach this. The target must
// already be an ADMIN-role account; a staffRole on a Better/Boardman
// account would be meaningless (they can never pass requireRole('ADMIN')
// to use it).
async function setStaffRole(targetUserId, staffRole, actingAdminId) {
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) throw new AppError('User not found', 404);
  if (target.role !== 'ADMIN') {
    throw new AppError('Only an ADMIN-role account can hold a staff role', 422);
  }

  const updated = await prisma.user.update({
    where: { id: targetUserId },
    data: { staffRole },
    select: STAFF_VISIBLE_USER_FIELDS,
  });
  await recordAuditLog({
    actorUserId: actingAdminId,
    action: 'STAFF_ROLE_CHANGED',
    entityType: 'User',
    entityId: targetUserId,
    beforeState: { staffRole: target.staffRole },
    afterState: { staffRole },
  });
  return updated;
}

module.exports = {
  listPendingBoardmen,
  listAllBoardmen,
  approveBoardman,
  rejectBoardman,
  suspendBoardman,
  suspendUser,
  reactivateUser,
  listUsers,
  getFinancialLedger,
  setStaffRole,
};
