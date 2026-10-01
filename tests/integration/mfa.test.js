const request = require('supertest');
const { generate: totpGenerate } = require('@otplib/totp');
const app = require('../../server/app');
const { resetDatabase, prisma } = require('../helpers/reset');
const mfaService = require('../../server/services/mfaService');
const password = require('../../server/utils/password');
const { signMfaChallengeToken } = require('../../server/utils/jwt');
const { base32Plugin, cryptoPlugin } = require('../../server/utils/totpPlugins');

// Codes are single-use per 30s step, so tests can't just generate "the
// current code" twice. The clock is pinned mid-step and each generate()
// moves it to the next step first — the same as a user waiting for their
// app to show a new code. Deterministic regardless of when the suite runs.
const STEP_MS = 30000;
let clockMs;

function codeAt(secret, epochMs) {
  return totpGenerate({ secret, crypto: cryptoPlugin, base32: base32Plugin, epoch: Math.floor(epochMs / 1000) });
}

function generate({ secret }) {
  clockMs += STEP_MS;
  return codeAt(secret, clockMs);
}

beforeEach(() => {
  clockMs = Math.floor(Date.now() / STEP_MS) * STEP_MS + STEP_MS / 2;
  jest.spyOn(Date, 'now').mockImplementation(() => clockMs);
});

afterEach(() => {
  jest.restoreAllMocks();
});

let counter = 0;
async function createAdmin(staffRole = 'SUPER_ADMIN') {
  counter += 1;
  const phone = `0920${String(counter).padStart(7, '0')}`;
  const passwordHash = await password.hash('1234');
  const user = await prisma.user.create({
    data: { role: 'ADMIN', fullName: 'Staff Person', phone, passwordHash, staffRole },
  });
  return { user, phone };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('MFA enrollment (TASK-031)', () => {
  it('startSetup generates a secret but does not enable MFA yet', async () => {
    const { user } = await createAdmin();
    const { secret, otpauthUrl } = await mfaService.startSetup(user.id);

    expect(secret).toBeTruthy();
    expect(otpauthUrl).toContain('otpauth://');

    const reloaded = await prisma.user.findUnique({ where: { id: user.id } });
    expect(reloaded.mfaSecret).toBe(secret);
    expect(reloaded.mfaEnabledAt).toBeNull();
  });

  it('confirmSetup rejects an incorrect code and leaves MFA disabled', async () => {
    const { user } = await createAdmin();
    await mfaService.startSetup(user.id);

    await expect(mfaService.confirmSetup(user.id, '000000')).rejects.toMatchObject({ statusCode: 400 });

    const reloaded = await prisma.user.findUnique({ where: { id: user.id } });
    expect(reloaded.mfaEnabledAt).toBeNull();
  });

  it('confirmSetup with the correct code enables MFA', async () => {
    const { user } = await createAdmin();
    const { secret } = await mfaService.startSetup(user.id);
    const code = await generate({ secret });

    await mfaService.confirmSetup(user.id, code);

    const reloaded = await prisma.user.findUnique({ where: { id: user.id } });
    expect(reloaded.mfaEnabledAt).not.toBeNull();
  });

  it('disableMfa requires a valid current code', async () => {
    const { user } = await createAdmin();
    const { secret } = await mfaService.startSetup(user.id);
    const code = await generate({ secret });
    await mfaService.confirmSetup(user.id, code);

    await expect(mfaService.disableMfa(user.id, '000000')).rejects.toMatchObject({ statusCode: 400 });

    const freshCode = await generate({ secret });
    await mfaService.disableMfa(user.id, freshCode);

    const reloaded = await prisma.user.findUnique({ where: { id: user.id } });
    expect(reloaded.mfaEnabledAt).toBeNull();
    expect(reloaded.mfaSecret).toBeNull();
  });

  it('/users/me reports MFA status without ever exposing the secret', async () => {
    const { phone } = await createAdmin();
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ phone, pin: '1234' });

    const before = await agent.get('/api/users/me');
    expect(before.body.user.mfaEnabled).toBe(false);

    const { body: setup } = await agent.post('/api/auth/mfa/setup');
    await agent.post('/api/auth/mfa/setup/confirm').send({ code: await generate({ secret: setup.secret }) });

    const after = await agent.get('/api/users/me');
    expect(after.body.user.mfaEnabled).toBe(true);
    expect(JSON.stringify(after.body)).not.toContain(setup.secret);
  });


  it('enrollment endpoints are only reachable by an authenticated ADMIN', async () => {
    const res = await request(app).post('/api/auth/mfa/setup');
    expect(res.status).toBe(401);
  });
});

describe('Login gate for MFA-enabled staff (TASK-031)', () => {
  it('an admin without MFA enabled logs in with a single step, same as before', async () => {
    const { phone } = await createAdmin();
    const res = await request(app).post('/api/auth/login').send({ phone, pin: '1234' });

    expect(res.status).toBe(200);
    expect(res.body.mfaRequired).toBeUndefined();
    expect(res.body.user.role).toBe('ADMIN');
    expect(res.headers['set-cookie']).toBeTruthy();
  });

  it('an admin with MFA enabled gets a challenge instead of a session on login', async () => {
    const { user, phone } = await createAdmin();
    const { secret } = await mfaService.startSetup(user.id);
    await mfaService.confirmSetup(user.id, await generate({ secret }));

    const res = await request(app).post('/api/auth/login').send({ phone, pin: '1234' });

    expect(res.status).toBe(200);
    expect(res.body.mfaRequired).toBe(true);
    expect(res.body.mfaToken).toBeTruthy();
    expect(res.body.user).toBeUndefined();
    expect(res.headers['set-cookie']).toBeFalsy();
  });

  it('completing the challenge with the correct code establishes a session', async () => {
    const { user, phone } = await createAdmin();
    const { secret } = await mfaService.startSetup(user.id);
    await mfaService.confirmSetup(user.id, await generate({ secret }));

    const loginRes = await request(app).post('/api/auth/login').send({ phone, pin: '1234' });
    const { mfaToken } = loginRes.body;

    const verifyRes = await request(app)
      .post('/api/auth/mfa/verify')
      .send({ mfaToken, code: await generate({ secret }) });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.user.role).toBe('ADMIN');
    expect(verifyRes.headers['set-cookie']).toBeTruthy();
  });

  it('rejects an incorrect code at the challenge step', async () => {
    const { user, phone } = await createAdmin();
    const { secret } = await mfaService.startSetup(user.id);
    await mfaService.confirmSetup(user.id, await generate({ secret }));

    const loginRes = await request(app).post('/api/auth/login').send({ phone, pin: '1234' });
    const { mfaToken } = loginRes.body;

    const verifyRes = await request(app).post('/api/auth/mfa/verify').send({ mfaToken, code: '000000' });

    expect(verifyRes.status).toBe(400);
    expect(verifyRes.headers['set-cookie']).toBeFalsy();
  });

  it('rejects an expired or forged mfaToken', async () => {
    const res = await request(app)
      .post('/api/auth/mfa/verify')
      .send({ mfaToken: 'not-a-real-token', code: '123456' });

    expect(res.status).toBe(401);
  });

  it('an MFA challenge token cannot be used as a session cookie to bypass the second step', async () => {
    const { user } = await createAdmin();
    const { secret } = await mfaService.startSetup(user.id);
    await mfaService.confirmSetup(user.id, await generate({ secret }));

    const challengeToken = signMfaChallengeToken(user);
    const res = await request(app).get('/api/admin/overview').set('Cookie', [`sb_access=${challengeToken}`]);

    expect(res.status).toBe(401);
  });
});

describe('One-time use of TOTP codes (ASVS 2.8.4)', () => {
  async function enrolledAdmin() {
    const { user, phone } = await createAdmin();
    const { secret } = await mfaService.startSetup(user.id);
    await mfaService.confirmSetup(user.id, await generate({ secret }));
    return { user, phone, secret };
  }

  async function challengeToken(phone) {
    const res = await request(app).post('/api/auth/login').send({ phone, pin: '1234' });
    return res.body.mfaToken;
  }

  it('rejects the same code a second time, even inside its 30s window', async () => {
    const { phone, secret } = await enrolledAdmin();
    const code = await generate({ secret });

    const first = await request(app).post('/api/auth/mfa/verify').send({ mfaToken: await challengeToken(phone), code });
    expect(first.status).toBe(200);

    const replay = await request(app).post('/api/auth/mfa/verify').send({ mfaToken: await challengeToken(phone), code });
    expect(replay.status).toBe(400);
    expect(replay.body.error).toMatch(/already been used/);
  });

  it('does not let the enrollment code be reused to log in', async () => {
    const { user, phone } = await createAdmin();
    const { secret } = await mfaService.startSetup(user.id);
    const setupCode = await generate({ secret });
    await mfaService.confirmSetup(user.id, setupCode);

    const res = await request(app).post('/api/auth/mfa/verify').send({ mfaToken: await challengeToken(phone), code: setupCode });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already been used/);
  });

  it('lets only one of two simultaneous logins with the same code succeed', async () => {
    const { phone, secret } = await enrolledAdmin();
    const [tokenA, tokenB] = [await challengeToken(phone), await challengeToken(phone)];
    const code = await generate({ secret });

    const results = await Promise.all([
      request(app).post('/api/auth/mfa/verify').send({ mfaToken: tokenA, code }),
      request(app).post('/api/auth/mfa/verify').send({ mfaToken: tokenB, code }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  });

  it('rejects an older code once a newer one has been used', async () => {
    const { user, secret } = await enrolledAdmin();
    const older = await codeAt(secret, clockMs + STEP_MS);
    const newer = await codeAt(secret, clockMs + 2 * STEP_MS);
    clockMs += 2 * STEP_MS;

    expect(await mfaService.verifyToken(user.id, newer)).toBe(true);
    await expect(mfaService.verifyToken(user.id, older)).rejects.toThrow(/already been used/);
  });

  it('tolerates one step of phone clock drift, but not two', async () => {
    const { user, secret } = await enrolledAdmin();
    clockMs += 5 * STEP_MS;

    expect(await mfaService.verifyToken(user.id, await codeAt(secret, clockMs - 2 * STEP_MS))).toBe(false);
    expect(await mfaService.verifyToken(user.id, await codeAt(secret, clockMs - STEP_MS))).toBe(true);
    expect(await mfaService.verifyToken(user.id, await codeAt(secret, clockMs + STEP_MS))).toBe(true);
    expect(await mfaService.verifyToken(user.id, await codeAt(secret, clockMs + 2 * STEP_MS))).toBe(false);
  });

  it('starts fresh when MFA is set up again with a new secret', async () => {
    const { user, secret } = await enrolledAdmin();
    await mfaService.disableMfa(user.id, await generate({ secret }));

    const again = await mfaService.startSetup(user.id);
    const reloaded = await prisma.user.findUnique({ where: { id: user.id } });
    expect(reloaded.mfaLastTimeStep).toBeNull();
    await expect(mfaService.confirmSetup(user.id, await codeAt(again.secret, clockMs))).resolves.toEqual({ enabled: true });
  });
});
