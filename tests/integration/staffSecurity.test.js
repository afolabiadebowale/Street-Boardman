const request = require('supertest');
const { generate: totpGenerate } = require('@otplib/totp');
const app = require('../../server/app');
const env = require('../../server/config/env');
const { resetDatabase, prisma } = require('../helpers/reset');
const password = require('../../server/utils/password');
const { base32Plugin, cryptoPlugin } = require('../../server/utils/totpPlugins');

// Staff security gate (TASK-036 O1 + O2): once STAFF_SECURITY_ENFORCED_FROM
// has passed, admin routes need MFA and a 12+ character password. Before
// that date it's a banner only.
const STRONG = 'correct horse battery';
let originalEnforcedFrom;
let counter = 0;

async function admin(pin) {
  counter += 1;
  const phone = `0948000000${counter}`;
  await prisma.user.create({
    data: { role: 'ADMIN', staffRole: 'SUPER_ADMIN', fullName: 'Staff', phone, passwordHash: await password.hash(pin) },
  });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ phone, pin });
  expect(res.status).toBe(200);
  return { agent, phone };
}

async function enableMfa(agent) {
  const { body } = await agent.post('/api/auth/mfa/setup');
  const code = await totpGenerate({ secret: body.secret, crypto: cryptoPlugin, base32: base32Plugin });
  expect((await agent.post('/api/auth/mfa/setup/confirm').send({ code })).status).toBe(200);
}

beforeEach(async () => {
  await resetDatabase();
  originalEnforcedFrom = env.staffSecurityEnforcedFrom;
});

afterEach(() => {
  env.staffSecurityEnforcedFrom = originalEnforcedFrom;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Staff security gate', () => {
  it('walks an admin through MFA, then a strong password, before admin tools open', async () => {
    env.staffSecurityEnforcedFrom = new Date(0);
    const { agent } = await admin('1234');

    const noMfa = await agent.get('/api/admin/overview');
    expect(noMfa.status).toBe(403);
    expect(noMfa.body.code).toBe('MFA_REQUIRED');

    await enableMfa(agent); // the MFA endpoints stay reachable while gated

    const weak = await agent.get('/api/admin/overview');
    expect(weak.status).toBe(403);
    expect(weak.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await agent.post('/api/auth/password').send({ currentPassword: '1234', newPassword: STRONG });
    expect(changed.status).toBe(200);
    expect(changed.body.user.staffSecurity).toMatchObject({ mfaRequired: false, passwordChangeRequired: false });

    expect((await agent.get('/api/admin/overview')).status).toBe(200);
  });

  it('is a warning only before the enforcement date (grace period)', async () => {
    env.staffSecurityEnforcedFrom = new Date(Date.now() + 7 * 86400000);
    const { agent } = await admin('1234');

    expect((await agent.get('/api/admin/overview')).status).toBe(200);
    const me = await agent.get('/api/users/me');
    expect(me.body.user.staffSecurity).toMatchObject({ enforced: false, mfaRequired: true, passwordChangeRequired: true });
    expect(me.body.user.staffSecurity.enforcedFrom).toBe(env.staffSecurityEnforcedFrom.toISOString());
  });

  it('flags a short staff password at login and clears it once a long one is used', async () => {
    const { phone } = await admin('1234');
    expect((await prisma.user.findUnique({ where: { phone } })).mustChangePassword).toBe(true);

    await prisma.user.update({ where: { phone }, data: { passwordHash: await password.hash(STRONG) } });
    await request(app).post('/api/auth/login').send({ phone, pin: STRONG });
    expect((await prisma.user.findUnique({ where: { phone } })).mustChangePassword).toBe(false);
  });

  it('never applies to bettors', async () => {
    const res = await request(app).post('/api/auth/register/better').send({ fullName: 'Bettor', phone: '09481000001', pin: '1234' });
    expect(res.body.user.staffSecurity).toBeNull();
  });
});

describe('Changing a password', () => {
  it('needs the current password, and wrong guesses count toward lockout', async () => {
    const { agent, phone } = await admin('1234');
    const res = await agent.post('/api/auth/password').send({ currentPassword: '0000', newPassword: STRONG });
    expect(res.status).toBe(401);
    expect((await prisma.user.findUnique({ where: { phone } })).failedLoginCount).toBe(1);
  });

  it('enforces the staff rules: 12+ characters, no phone number, not the same as before', async () => {
    const { agent, phone } = await admin(STRONG);
    const tryNew = (newPassword) => agent.post('/api/auth/password').send({ currentPassword: STRONG, newPassword });

    expect((await tryNew('short-pass')).body.error).toMatch(/at least 12/);
    expect((await tryNew(`my number ${phone}`)).body.error).toMatch(/phone number/);
    expect((await tryNew(STRONG)).body.error).toMatch(/different/);
  });

  it('signs out every other device, keeps this one, and records it', async () => {
    const { agent, phone } = await admin(STRONG);
    const other = request.agent(app);
    await other.post('/api/auth/login').send({ phone, pin: STRONG });

    expect((await agent.post('/api/auth/password').send({ currentPassword: STRONG, newPassword: 'another long password' })).status).toBe(200);

    expect((await agent.get('/api/users/me')).status).toBe(200);
    expect((await other.get('/api/users/me')).status).toBe(401);
    const user = await prisma.user.findUnique({ where: { phone } });
    expect(await prisma.auditLog.count({ where: { action: 'PASSWORD_CHANGED', entityId: user.id } })).toBe(1);
  });

  it('lets a bettor change their PIN with the normal 4-character minimum', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register/better').send({ fullName: 'Bettor', phone: '09481000002', pin: '1234' });
    expect((await agent.post('/api/auth/password').send({ currentPassword: '1234', newPassword: '5678' })).status).toBe(200);
  });
});
