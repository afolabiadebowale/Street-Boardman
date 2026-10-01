const request = require('supertest');
const app = require('../../server/app');
const { resetDatabase, prisma } = require('../helpers/reset');

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// TASK-032: this is a JSON-only API (the SPA is a separate deployment), so
// CSP is locked all the way down and HSTS is always advertised — a browser
// only acts on HSTS over an actual HTTPS connection, so sending it in dev
// over http is inert, not harmful.
describe('Security headers on every response (TASK-032)', () => {
  it('sets a locked-down CSP, HSTS, and standard hardening headers', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    // Exact match, not toContain: helmet silently merges extra default
    // directives unless told not to, and toContain would miss that.
    expect(res.headers['content-security-policy']).toBe("default-src 'none';frame-ancestors 'none'");
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(res.headers['strict-transport-security']).toContain('includeSubDomains');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });
});

describe('Session cookie attributes (TASK-032)', () => {
  it('login issues HttpOnly, SameSite cookies (not Secure outside production)', async () => {
    const res = await request(app)
      .post('/api/auth/register/better')
      .send({ fullName: 'Cookie Tester', phone: '08099999999', pin: '1234' });

    expect(res.status).toBe(201);
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeTruthy();
    for (const cookie of setCookie) {
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      // NODE_ENV=test here, not production, so Secure should be absent —
      // matches env.cookies.secure being false outside production/None.
      expect(cookie).not.toMatch(/Secure/i);
    }
  });
});
