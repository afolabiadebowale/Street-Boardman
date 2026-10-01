import http from 'k6/http';
import { check, fail, sleep } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'http://api:4000';
export const ADMIN_PHONE = __ENV.ADMIN_PHONE || '08000000000';
export const ADMIN_PIN = __ENV.ADMIN_PIN || 'Admin@12345';
export const PIN = '1234';

// A unique run tag keeps phone numbers from colliding across runs against
// the same database (phones are unique). 3 digits + 6-digit user index.
// k6 evaluates this file separately in setup() and in every VU, so a
// random default would differ between them: setup() must return RUN and
// VUs must pass data.run back in — never read RUN from a VU.
export const RUN = __ENV.RUN_TAG || String(Math.floor(Math.random() * 900) + 100);
export const phoneFor = (kind, i, run = RUN) => `0${kind}${run}${String(i).padStart(6, '0')}`;

// Every simulated user gets its own client IP, sent as X-Forwarded-For.
// The load profile runs the API with TRUST_PROXY_HOPS=1 and no proxy in
// front, so the API reads this as the real client address — the per-IP
// limits (20 logins / 15 min, 30 bets / min) then apply per simulated
// phone, as they would in production, instead of throttling the whole
// test as one IP.
export function ipFor(i) {
  return `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;
}

// The stack runs with NODE_ENV=production, so session cookies are Secure.
// k6's cookie jar won't send Secure cookies over the plain-HTTP hop inside
// the compose network, so the session is carried as an explicit header.
export function sessionFrom(res) {
  const cookies = res.cookies || {};
  const access = cookies.sb_access && cookies.sb_access[0] && cookies.sb_access[0].value;
  if (!access) return null;
  return `sb_access=${access}`;
}

export function params(ip, session, tags = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Forwarded-For': ip };
  if (session) headers.Cookie = session;
  return { headers, tags };
}

export function post(path, body, ip, session, tags) {
  return http.post(`${BASE_URL}${path}`, JSON.stringify(body || {}), params(ip, session, tags));
}

export function patch(path, body, ip, session, tags) {
  return http.patch(`${BASE_URL}${path}`, JSON.stringify(body || {}), params(ip, session, tags));
}

export function get(path, ip, session, tags) {
  return http.get(`${BASE_URL}${path}`, params(ip, session, tags));
}

export function must(res, status, what) {
  if (res.status !== status) fail(`${what}: expected ${status}, got ${res.status} — ${res.body && res.body.slice(0, 200)}`);
  return res.json();
}

export function login(phone, pin, ip) {
  const res = post('/api/auth/login', { phone, pin }, ip, null, { name: 'login' });
  check(res, { 'login 200': (r) => r.status === 200 });
  return sessionFrom(res);
}

// For VUs: logs in once per VU. A failure backs off instead of retrying
// on the next iteration immediately — a tight retry loop burns through
// the per-IP auth limit in milliseconds and then measures only 429s.
export function vuSession(state, phone, ip) {
  if (state.session) return state.session;
  if (state.failures >= 3) {
    sleep(5);
    return null;
  }
  state.session = login(phone, PIN, ip);
  if (!state.session) {
    state.failures = (state.failures || 0) + 1;
    sleep(2);
  }
  return state.session;
}

export function adminSession() {
  const res = post('/api/auth/login', { phone: ADMIN_PHONE, pin: ADMIN_PIN }, '10.255.255.1');
  const body = must(res, 200, 'admin login (run the seed first — see docs/LOAD_TESTING.md)');
  if (body.mfaRequired) fail('The load-test admin has MFA enabled; use an admin without MFA for setup.');
  return sessionFrom(res);
}

// Registers and approves a Boardman, then opens a competition. Returns
// what the scenarios need: the Boardman's session and the option ids.
export function createCompetition(admin, { index, options = ['Home', 'Away'] }) {
  const ip = ipFor(900000 + index);
  const phone = phoneFor('81', index);
  const reg = post('/api/auth/register/boardman', {
    fullName: `Load Boardman ${index}`,
    phone,
    pin: PIN,
    businessLocation: 'Lagos',
  }, ip);
  must(reg, 201, 'register boardman');
  const boardman = sessionFrom(reg);

  const pending = must(get('/api/admin/boardmen/pending', '10.255.255.1', admin), 200, 'list pending boardmen');
  const profile = pending.boardmen.find((b) => b.user && b.user.phone === phone);
  if (!profile) fail('new boardman not in pending list');
  must(patch(`/api/admin/boardmen/${profile.id}/approve`, {}, '10.255.255.1', admin), 200, 'approve boardman');

  const created = must(post('/api/competitions', {
    title: `Load test ${RUN}-${index}`,
    category: 'FOOTBALL',
    bettingDeadline: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
    options,
  }, ip, boardman), 201, 'create competition').competition;

  return { boardman, boardmanIp: ip, competitionId: created.id, optionIds: created.betOptions.map((o) => o.id) };
}

// Registers a funded bettor. Registration bcrypt-hashes the PIN (~100 ms
// on the server), which is why setup — not the measured phase — does it.
export function createBettor(index, deposit) {
  const ip = ipFor(index);
  const reg = post('/api/auth/register/better', { fullName: `Load Bettor ${index}`, phone: phoneFor('70', index), pin: PIN }, ip);
  must(reg, 201, `register bettor ${index}`);
  const session = sessionFrom(reg);
  must(post('/api/deposits/demo', { amount: deposit }, ip, session), 201, `deposit for bettor ${index}`);
  return { ip, phone: phoneFor('70', index) };
}
