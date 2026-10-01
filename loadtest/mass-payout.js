// Mass payout: one competition with many bets settles while other users
// keep using the app. Measures how long the worker takes to pay everyone
// and whether the API slows down meanwhile. See docs/LOAD_TESTING.md.
//
// Settlement goes through the real production path: the result
// confirmation window is set to 0 for the run, so the worker's
// every-minute auto-confirm sweep picks the result up and pays out
// (TASK-005/006). The window is restored afterwards.
import { check, sleep, fail } from 'k6';
import { Trend, Gauge } from 'k6/metrics';
import * as lib from './lib.js';

const BETTORS = Number(__ENV.BETTORS || 300);
const BETS_EACH = Number(__ENV.BETS_EACH || 3);
const BACKGROUND_USERS = Number(__ENV.BACKGROUND_USERS || 50);

const waitForSweep = new Trend('payout_wait_for_sweep_s');
const payoutRun = new Trend('payout_processing_s');
const payoutTotal = new Trend('payout_total_s');
const betsSettled = new Gauge('payout_bets_settled');

export const options = {
  setupTimeout: '20m',
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  scenarios: {
    settle: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '15m', exec: 'settle' },
    background: {
      executor: 'constant-vus',
      vus: BACKGROUND_USERS,
      duration: __ENV.BACKGROUND_DURATION || '3m',
      exec: 'background',
    },
  },
  thresholds: {
    payout_processing_s: ['max<120'],
    'http_req_duration{name:background_read}': ['p(95)<500'],
    'http_req_duration{name:background_bet}': ['p(95)<800'],
    'http_req_failed{name:background_bet}': ['rate<0.01'],
  },
};

export function setup() {
  const admin = lib.adminSession();
  const before = lib.must(lib.get('/api/admin/settings', '10.255.255.1', admin), 200, 'read settings').settings;
  lib.must(
    lib.patch('/api/admin/settings', { resultConfirmationWindowHours: 0 }, '10.255.255.1', admin),
    200,
    'set confirmation window to 0'
  );

  const big = lib.createCompetition(admin, { index: 2 });
  const other = lib.createCompetition(admin, { index: 3 });

  // Bets alternate sides, so about half the bettors win.
  for (let i = 1; i <= BETTORS; i += 1) {
    lib.createBettor(i, 50000);
    const ip = lib.ipFor(i);
    const session = lib.login(lib.phoneFor('70', i), lib.PIN, ip);
    for (let b = 0; b < BETS_EACH; b += 1) {
      lib.must(
        lib.post('/api/bets', { betOptionId: big.optionIds[(i + b) % 2], stake: 100 + ((i * 37 + b * 11) % 400) }, ip, session),
        201,
        `setup bet ${i}.${b}`
      );
    }
  }
  // Background users bet on a different competition.
  for (let i = BETTORS + 1; i <= BETTORS + BACKGROUND_USERS; i += 1) lib.createBettor(i, 200000);

  return { big, other, admin, previousWindow: before.resultConfirmationWindowHours, run: lib.RUN };
}

export function settle(data) {
  const { big } = data;
  lib.must(lib.patch(`/api/competitions/${big.competitionId}/close-betting`, {}, big.boardmanIp, big.boardman), 200, 'close betting');
  lib.must(
    lib.post(`/api/competitions/${big.competitionId}/result`, { winningOptionId: big.optionIds[0] }, big.boardmanIp, big.boardman),
    201,
    'submit result'
  );

  const submitted = Date.now();
  for (;;) {
    const c = lib.must(lib.get(`/api/competitions/${big.competitionId}`, '10.255.255.2'), 200, 'poll').competition;
    if (c.status === 'COMPLETED') break;
    if (Date.now() - submitted > 14 * 60 * 1000) fail(`payout did not complete; stuck at ${c.status}`);
    sleep(0.5);
  }

  // Timings from the server's own timestamps — polling can't resolve a
  // payout that finishes in under a poll interval. Result created ->
  // confirmed by the sweep -> competition completed (last write of
  // finalizePayout).
  const all = lib.must(lib.get('/api/admin/competitions', '10.255.255.1', data.admin), 200, 'admin competitions').competitions;
  const c = all.find((x) => x.id === big.competitionId);
  const created = Date.parse(c.result.createdAt);
  const confirmed = Date.parse(c.result.confirmedAt);
  const completed = Date.parse(c.updatedAt);

  waitForSweep.add((confirmed - created) / 1000);
  payoutRun.add((completed - confirmed) / 1000);
  payoutTotal.add((completed - created) / 1000);
  betsSettled.add(BETTORS * BETS_EACH);
  check(c, { 'competition paid out': (x) => x.status === 'COMPLETED' });
}

const state = {};

export function background(data) {
  const index = BETTORS + ((__VU - 1) % BACKGROUND_USERS) + 1;
  const ip = lib.ipFor(index);
  const session = lib.vuSession(state, lib.phoneFor('70', index, data.run), ip);
  if (!session) return;
  lib.get('/api/competitions', ip, session, { name: 'background_read' });
  lib.get('/api/wallet/me', ip, session, { name: 'background_read' });
  const res = lib.post(
    '/api/bets',
    { betOptionId: data.other.optionIds[Math.floor(Math.random() * 2)], stake: 100 + Math.floor(Math.random() * 400) },
    ip,
    session,
    { name: 'background_bet' }
  );
  check(res, { 'background bet accepted': (r) => r.status === 201 });
  sleep(2 + Math.random() * 2);
}

export function teardown(data) {
  lib.patch('/api/admin/settings', { resultConfirmationWindowHours: data.previousWindow }, '10.255.255.1', data.admin);
}

export function handleSummary(summary) {
  const m = summary.metrics;
  const v = (name, stat) => (m[name] ? m[name].values[stat] : undefined);
  const s = (x) => (x === undefined ? 'n/a' : `${x.toFixed(1)} s`);
  const ms = (x) => (x === undefined ? 'n/a' : `${Math.round(x)} ms`);
  const bets = BETTORS * BETS_EACH;
  const run = v('payout_processing_s', 'max');
  const text = [
    '',
    `Mass payout — ${bets} bets from ${BETTORS} bettors, ${BACKGROUND_USERS} users active meanwhile (run ${lib.RUN})`,
    `  waiting for the worker sweep: ${s(v('payout_wait_for_sweep_s', 'max'))}  (sweep runs once a minute)`,
    `  payout processing:            ${s(run)}${run ? `  (~${Math.round(bets / run)} bets/s)` : ''}`,
    `  result submitted -> all paid: ${s(v('payout_total_s', 'max'))}`,
    `  background reads p95:         ${ms(v('http_req_duration{name:background_read}', 'p(95)'))}`,
    `  background bets p95/p99:      ${ms(v('http_req_duration{name:background_bet}', 'p(95)'))} / ${ms(v('http_req_duration{name:background_bet}', 'p(99)'))}`,
    '',
  ].join('\n');
  return { stdout: text, [`/scripts/results/mass-payout-${lib.RUN}.json`]: JSON.stringify(summary, null, 2) };
}
