const request = require('supertest');
const app = require('../../server/app');
const adminRouter = require('../../server/routes/admin');
const { resetDatabase, prisma } = require('../helpers/reset');
const password = require('../../server/utils/password');
const walletService = require('../../server/services/walletService');
const depositService = require('../../server/services/depositService');

// Admin list endpoints used to send whole User rows — PIN hashes and TOTP
// secrets included — to any staff member with view access. With another
// admin's MFA secret you can generate their codes; with their hash you
// can crack a short PIN offline. This checks every admin response, and
// discovers GET routes from the router itself so new ones are covered
// automatically (found during TASK-036).
const SECRET_FIELDS = ['passwordHash', 'mfaSecret', 'mfaLastTimeStep', 'tokenVersion', 'failedLoginCount', 'deviceFingerprint'];
const MFA_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

function findSecretKeys(value, path = '$', found = []) {
  if (Array.isArray(value)) value.forEach((v, i) => findSecretKeys(v, `${path}[${i}]`, found));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_FIELDS.includes(k)) found.push(`${path}.${k}`);
      findSecretKeys(v, `${path}.${k}`, found);
    }
  }
  return found;
}

function expectNoSecrets(res, label) {
  expect({ label, leaks: findSecretKeys(res.body) }).toEqual({ label, leaks: [] });
  expect(res.text).not.toContain(MFA_SECRET);
  expect(res.text).not.toMatch(/\$2[aby]\$\d\d\$/); // any bcrypt hash
}

let agent;
let ids;

beforeAll(async () => {
  await resetDatabase();
  const hash = await password.hash('1234');
  const mk = async (data, walletType) => {
    const user = await prisma.user.create({ data: { passwordHash: hash, mfaSecret: MFA_SECRET, deviceFingerprint: 'fp', ...data } });
    if (walletType) await walletService.createWalletForUser(prisma, user.id, walletType, true);
    return user;
  };

  // The acting staff member has a secret too (enrollment in progress, so
  // login stays single-step) — the most tempting row to leak.
  const staff = await mk({ role: 'ADMIN', staffRole: 'SUPER_ADMIN', fullName: 'Viewer', phone: '09460000001' }, 'PLATFORM');
  const otherAdmin = await mk({ role: 'ADMIN', staffRole: 'FINANCE', fullName: 'Other', phone: '09460000002', mfaEnabledAt: new Date() });
  const better = await mk({ role: 'BETTER', fullName: 'Bettor', phone: '09460000003' }, 'BETTER');
  const boardmanUser = await mk({ role: 'BOARDMAN', fullName: 'Board', phone: '09460000004' }, 'BOARDMAN');
  const pendingUser = await mk({ role: 'BOARDMAN', fullName: 'Pending', phone: '09460000005' }, 'BOARDMAN');

  const profile = await prisma.boardmanProfile.create({
    data: { userId: boardmanUser.id, businessLocation: 'Lagos', approvalStatus: 'APPROVED', approvedByAdminId: staff.id, approvedAt: new Date() },
  });
  const pending = await prisma.boardmanProfile.create({ data: { userId: pendingUser.id, businessLocation: 'Lagos' } });
  await prisma.competition.create({
    data: {
      boardmanProfileId: profile.id,
      title: 'Exposure check',
      category: 'FOOTBALL',
      status: 'BETTING_OPEN',
      bettingDeadline: new Date(Date.now() + 86400000),
      boardmanCommissionRate: 0.05,
      platformCommissionRate: 0.03,
      betOptions: { create: [{ label: 'A' }, { label: 'B' }] },
    },
  });
  await depositService.createDemoDeposit(better.id, 500);

  agent = request.agent(app);
  const login = await agent.post('/api/auth/login').send({ phone: '09460000001', pin: '1234' });
  expect(login.status).toBe(200);
  ids = { otherAdmin: otherAdmin.id, better: better.id, pending: pending.id, profile: profile.id };
});

afterAll(async () => {
  await prisma.$disconnect();
});

const getRoutes = adminRouter.stack
  .filter((layer) => layer.route && layer.route.methods.get && !layer.route.path.includes(':'))
  .map((layer) => layer.route.path);

describe('Admin responses never contain credentials or secrets', () => {
  it('discovers the admin GET routes', () => {
    expect(getRoutes).toEqual(expect.arrayContaining(['/users', '/boardmen', '/boardmen/pending', '/ledger', '/competitions']));
  });

  it.each(getRoutes)('GET /api/admin%s', async (path) => {
    const res = await agent.get(`/api/admin${path}`);
    expect(res.status).toBe(200);
    expectNoSecrets(res, path);
  });

  it('write actions return no secrets either', async () => {
    const calls = [
      ['approve boardman', () => agent.patch(`/api/admin/boardmen/${ids.pending}/approve`)],
      ['suspend boardman', () => agent.patch(`/api/admin/boardmen/${ids.profile}/suspend`)],
      ['suspend user', () => agent.patch(`/api/admin/users/${ids.better}/suspend`)],
      ['reactivate user', () => agent.patch(`/api/admin/users/${ids.better}/reactivate`)],
      ['set staff role', () => agent.patch(`/api/admin/staff/${ids.otherAdmin}/role`).send({ staffRole: 'SUPPORT' })],
    ];
    for (const [label, call] of calls) {
      // eslint-disable-next-line no-await-in-loop
      const res = await call();
      expect({ label, status: res.status }).toEqual({ label, status: 200 });
      expectNoSecrets(res, label);
    }
  });

  it('still returns what staff need to do their job', async () => {
    const res = await agent.get('/api/admin/users');
    const other = res.body.users.find((u) => u.id === ids.otherAdmin);
    expect(other).toMatchObject({ fullName: 'Other', phone: '09460000002', role: 'ADMIN' });
    expect(other.mfaEnabledAt).not.toBeNull();
  });
});
