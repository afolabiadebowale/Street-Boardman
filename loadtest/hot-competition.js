// Hot competition: many bettors hammering one popular match at once.
// Every bet updates the same two BetOption.totalStaked rows, so this is
// the row-lock hotspot of the whole system. See docs/LOAD_TESTING.md.
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import * as lib from './lib.js';

const BETTORS = Number(__ENV.BETTORS || 200);
const HOLD = __ENV.HOLD || '3m';

const betsPlaced = new Counter('bets_placed');
const betsRejected = new Counter('bets_rejected');

export const options = {
  setupTimeout: '15m',
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  scenarios: {
    hot_competition: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: BETTORS },
        { duration: HOLD, target: BETTORS },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    'http_req_duration{name:place_bet}': ['p(95)<800', 'p(99)<2000'],
    'http_req_failed{name:place_bet}': ['rate<0.01'],
    'http_req_duration{name:view_competition}': ['p(95)<300'],
  },
};

export function setup() {
  const admin = lib.adminSession();
  const competition = lib.createCompetition(admin, { index: 1 });
  for (let i = 1; i <= BETTORS; i += 1) lib.createBettor(i, 200000);
  return { ...competition, run: lib.RUN };
}

// One session per VU, reused across iterations — real users log in once,
// not before every bet.
const state = {};

export default function (data) {
  const index = ((__VU - 1) % BETTORS) + 1;
  const ip = lib.ipFor(index);
  const session = lib.vuSession(state, lib.phoneFor('70', index, data.run), ip);
  if (!session) return;

  lib.get(`/api/competitions/${data.competitionId}`, ip, session, { name: 'view_competition' });

  const option = data.optionIds[Math.floor(Math.random() * data.optionIds.length)];
  const stake = 100 + Math.floor(Math.random() * 900);
  const res = lib.post('/api/bets', { betOptionId: option, stake }, ip, session, { name: 'place_bet' });
  if (check(res, { 'bet accepted': (r) => r.status === 201 })) betsPlaced.add(1);
  else betsRejected.add(1);

  // ~20 bets a minute per bettor: busy, but under the 30/min per-IP
  // betting limit, so the measurement is the system — not the limiter.
  sleep(2 + Math.random() * 2);
}

export function handleSummary(summary) {
  return {
    stdout: textSummary(summary),
    [`/scripts/results/hot-competition-${lib.RUN}.json`]: JSON.stringify(summary, null, 2),
  };
}

function textSummary(summary) {
  const m = summary.metrics;
  const bet = m['http_req_duration{name:place_bet}'];
  const view = m['http_req_duration{name:view_competition}'];
  const failed = m['http_req_failed{name:place_bet}'];
  const fmt = (v) => (v === undefined ? 'n/a' : `${Math.round(v)} ms`);
  return [
    '',
    `Hot competition — ${BETTORS} concurrent bettors (run ${lib.RUN})`,
    `  bets placed:        ${m.bets_placed ? m.bets_placed.values.count : 0}  (${m.bets_placed ? m.bets_placed.values.rate.toFixed(1) : 0}/s)`,
    `  bets rejected:      ${m.bets_rejected ? m.bets_rejected.values.count : 0}`,
    `  place_bet p50/p95/p99: ${fmt(bet && bet.values.med)} / ${fmt(bet && bet.values['p(95)'])} / ${fmt(bet && bet.values['p(99)'])}`,
    `  view p95:           ${fmt(view && view.values['p(95)'])}`,
    `  place_bet error rate: ${failed ? (failed.values.rate * 100).toFixed(2) : 'n/a'}%`,
    `  thresholds: ${Object.values(summary.metrics).every((x) => !x.thresholds || Object.values(x.thresholds).every((t) => t.ok)) ? 'ALL PASSED' : 'SOME FAILED'}`,
    '',
  ].join('\n');
}
