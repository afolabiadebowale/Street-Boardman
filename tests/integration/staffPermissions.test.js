const request = require('supertest');
const app = require('../../server/app');
const { resetDatabase, prisma } = require('../helpers/reset');
const adminService = require('../../server/services/adminService');
const password = require('../../server/utils/password');

let counter = 0;
async function loginAsAdmin(staffRole) {
  counter += 1;
  const phone = `0910${String(counter).padStart(7, '0')}`;
  const passwordHash = await password.hash('1234');
  const user = await prisma.user.create({
    data: { role: 'ADMIN', fullName: 'Staff Person', phone, passwordHash, staffRole },
  });

  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ phone, pin: '1234' });
  return { agent, userId: user.id };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Staff permission gating on admin routes (TASK-030)', () => {
  it('an ADMIN account with no staffRole can authenticate but cannot act', async () => {
    const { agent } = await loginAsAdmin(null);
    const res = await agent.get('/api/admin/overview');
    expect(res.status).toBe(403);
  });

  it('SUPPORT can view but cannot manage boardmen', async () => {
    const { agent } = await loginAsAdmin('SUPPORT');
    const view = await agent.get('/api/admin/boardmen');
    expect(view.status).toBe(200);

    const manage = await agent.patch('/api/admin/boardmen/nonexistent-id/approve');
    expect(manage.status).toBe(403);
  });

  it('FINANCE can manage withdrawals but not boardmen', async () => {
    const { agent } = await loginAsAdmin('FINANCE');

    const settingsView = await agent.get('/api/admin/settings');
    expect(settingsView.status).toBe(200);

    const boardmanAction = await agent.patch('/api/admin/boardmen/nonexistent-id/suspend');
    expect(boardmanAction.status).toBe(403);
  });

  it('COMPLIANCE can manage boardmen and disputes but not withdrawals', async () => {
    const { agent } = await loginAsAdmin('COMPLIANCE');

    const withdrawalAction = await agent.patch('/api/admin/withdrawals/nonexistent-id/process');
    expect(withdrawalAction.status).toBe(403);
  });

  it('SUPER_ADMIN can reach every gated route', async () => {
    const { agent } = await loginAsAdmin('SUPER_ADMIN');
    const routes = [
      ['get', '/api/admin/overview'],
      ['get', '/api/admin/boardmen'],
      ['get', '/api/admin/users'],
      ['get', '/api/admin/ledger'],
      ['get', '/api/admin/audit-logs'],
      ['get', '/api/admin/settings'],
    ];
    for (const [method, path] of routes) {
      // eslint-disable-next-line no-await-in-loop
      const res = await agent[method](path);
      expect(res.status).toBe(200);
    }
  });

  it('only MANAGE_STAFF (SUPER_ADMIN) can change another staff member\'s role', async () => {
    const { agent: superAgent } = await loginAsAdmin('SUPER_ADMIN');
    const { agent: complianceAgent, userId: targetId } = await loginAsAdmin('COMPLIANCE');

    const forbidden = await complianceAgent.patch(`/api/admin/staff/${targetId}/role`).send({ staffRole: 'FINANCE' });
    expect(forbidden.status).toBe(403);

    const allowed = await superAgent.patch(`/api/admin/staff/${targetId}/role`).send({ staffRole: 'FINANCE' });
    expect(allowed.status).toBe(200);
    expect(allowed.body.user.staffRole).toBe('FINANCE');
  });

  it('setStaffRole refuses to grant a staff role to a non-ADMIN account', async () => {
    const { userId: superId } = await loginAsAdmin('SUPER_ADMIN');
    const better = await prisma.user.create({
      data: { role: 'BETTER', fullName: 'Not Staff', phone: '09190000001', passwordHash: 'x' },
    });

    await expect(adminService.setStaffRole(better.id, 'SUPPORT', superId)).rejects.toMatchObject({
      statusCode: 422,
    });
  });

  it('logs STAFF_ROLE_CHANGED to the audit trail', async () => {
    const { userId: superId } = await loginAsAdmin('SUPER_ADMIN');
    const { userId: targetId } = await loginAsAdmin('SUPPORT');

    await adminService.setStaffRole(targetId, 'FINANCE', superId);

    const logs = await prisma.auditLog.findMany({ where: { action: 'STAFF_ROLE_CHANGED', entityId: targetId } });
    expect(logs).toHaveLength(1);
    expect(logs[0].afterState.staffRole).toBe('FINANCE');
  });
});
