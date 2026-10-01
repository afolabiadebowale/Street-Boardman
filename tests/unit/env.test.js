// TASK-008: production must never start with a missing, default, or short
// JWT secret. Each case reloads config/env.js fresh with a controlled
// process.env so we can assert the throw without polluting other tests.
describe('config/env — JWT secret fail-fast in production (TASK-008)', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  function loadEnv() {
    return require('../../server/config/env');
  }

  it('throws when JWT_ACCESS_SECRET is still the development default in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = 'a'.repeat(40);
    expect(loadEnv).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('throws when JWT_REFRESH_SECRET is shorter than 32 characters in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(40);
    process.env.JWT_REFRESH_SECRET = 'too-short';
    expect(loadEnv).toThrow(/JWT_REFRESH_SECRET/);
  });

  it('throws when JWT_MFA_CHALLENGE_SECRET is still the development default in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(40);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(40);
    delete process.env.JWT_MFA_CHALLENGE_SECRET;
    expect(loadEnv).toThrow(/JWT_MFA_CHALLENGE_SECRET/);
  });

  it('starts fine in production with three distinct, long secrets', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(40);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(40);
    process.env.JWT_MFA_CHALLENGE_SECRET = 'c'.repeat(40);
    expect(loadEnv).not.toThrow();
  });

  it('still allows the development defaults outside production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    expect(loadEnv).not.toThrow();
  });
});

describe('config/env — staff security enforcement date', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  const loadEnv = () => require('../../server/config/env');
  const prodSecrets = () => {
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(40);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(40);
    process.env.JWT_MFA_CHALLENGE_SECRET = 'c'.repeat(40);
  };

  it('is enforced immediately in production when unset', () => {
    process.env.NODE_ENV = 'production';
    prodSecrets();
    delete process.env.STAFF_SECURITY_ENFORCED_FROM;
    expect(loadEnv().staffSecurityEnforcedFrom.getTime()).toBe(0);
  });

  it('is off outside production when unset', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.STAFF_SECURITY_ENFORCED_FROM;
    expect(loadEnv().staffSecurityEnforcedFrom).toBeNull();
  });

  it('accepts a grace-period date and rejects nonsense', () => {
    process.env.NODE_ENV = 'production';
    prodSecrets();
    process.env.STAFF_SECURITY_ENFORCED_FROM = '2026-11-01';
    expect(loadEnv().staffSecurityEnforcedFrom.toISOString()).toBe('2026-11-01T00:00:00.000Z');

    jest.resetModules();
    process.env.STAFF_SECURITY_ENFORCED_FROM = 'next month';
    expect(loadEnv).toThrow(/STAFF_SECURITY_ENFORCED_FROM/);
  });
});

// TASK-032: session cookies must never end up SameSite=None without also
// being Secure — browsers silently drop that combination, which looks
// like a working login followed by every request being unauthenticated.
describe('config/env — cookie SameSite/Secure derivation (TASK-032)', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  function loadEnv() {
    return require('../../server/config/env');
  }

  it('defaults to SameSite=Lax and not Secure outside production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.COOKIE_SAME_SITE;
    const env = loadEnv();
    expect(env.cookies.sameSite).toBe('lax');
    expect(env.cookies.secure).toBe(false);
  });

  it('is Secure in production even with the default SameSite=Lax', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(40);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(40);
    process.env.JWT_MFA_CHALLENGE_SECRET = 'c'.repeat(40);
    delete process.env.COOKIE_SAME_SITE;
    const env = loadEnv();
    expect(env.cookies.sameSite).toBe('lax');
    expect(env.cookies.secure).toBe(true);
  });

  it('forces Secure whenever SameSite=None, even outside production', () => {
    process.env.NODE_ENV = 'development';
    process.env.COOKIE_SAME_SITE = 'none';
    const env = loadEnv();
    expect(env.cookies.sameSite).toBe('none');
    expect(env.cookies.secure).toBe(true);
  });

  it('rejects an invalid COOKIE_SAME_SITE value at startup', () => {
    process.env.NODE_ENV = 'development';
    process.env.COOKIE_SAME_SITE = 'sometimes';
    expect(loadEnv).toThrow(/COOKIE_SAME_SITE/);
  });
});
