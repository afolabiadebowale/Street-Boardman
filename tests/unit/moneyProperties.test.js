const fc = require('fast-check');
const { calculateCommission, calculateWinnerPayouts } = require('../../server/services/commissionService');
const { toDecimal } = require('../../server/utils/money');

// Property-based tests for the money math (TASK-045). Instead of a handful
// of hand-picked examples, fast-check generates thousands of random pools,
// stakes, and commission rates and checks invariants that must hold for
// every one of them — and shrinks any failure to the smallest example.

// Money is kobo-precise: generate integer kobo, express as naira.
const naira = (minKobo, maxKobo) => fc.integer({ min: minKobo, max: maxKobo }).map((k) => toDecimal(k).dividedBy(100));

// Rates as the admin settings allow them, in 0.0001 steps, with the two
// rates together never exceeding 100% of the pool.
const rates = fc
  .tuple(fc.integer({ min: 0, max: 10000 }), fc.integer({ min: 0, max: 10000 }))
  .filter(([b, p]) => b + p <= 10000)
  .map(([b, p]) => ({ boardmanRate: b / 10000, platformRate: p / 10000 }));

const winningStakes = fc.array(naira(1, 5_000_000_00), { minLength: 1, maxLength: 40 });

// Mirrors processPayoutsForCompetition: pool = winning stakes + losing
// stakes, commission off the top, winners split the rest pro rata, and
// any rounding remainder is folded into the platform's share.
function settle({ stakes, losingTotal, boardmanRate, platformRate }) {
  const winningTotal = stakes.reduce((s, x) => s.plus(x), toDecimal(0));
  const pool = winningTotal.plus(losingTotal);
  const commission = calculateCommission(pool, boardmanRate, platformRate);
  const payouts = calculateWinnerPayouts(
    stakes.map((stake, i) => ({ id: `b${i}`, stake })),
    winningTotal,
    commission.distributablePool
  );
  const paid = payouts.reduce((s, p) => s.plus(p.amount), toDecimal(0));
  const platformFinal = commission.platformAmount.plus(commission.distributablePool.minus(paid));
  return { pool, commission, payouts, paid, platformFinal, winningTotal };
}

describe('commission and payout math — properties (TASK-045)', () => {
  it('commission split always adds back up to exactly the pool', () => {
    fc.assert(
      fc.property(naira(0, 10_000_000_00), rates, (pool, { boardmanRate, platformRate }) => {
        const c = calculateCommission(pool, boardmanRate, platformRate);
        expect(c.boardmanAmount.plus(c.platformAmount).plus(c.distributablePool).equals(c.totalStakePool)).toBe(true);
        expect(c.boardmanAmount.gte(0) && c.platformAmount.gte(0) && c.distributablePool.gte(0)).toBe(true);
      }),
      { numRuns: 2000 }
    );
  });

  it('every kobo staked ends up with a winner, the boardman, or the platform — none created, none lost', () => {
    fc.assert(
      fc.property(winningStakes, naira(1, 5_000_000_00), rates, (stakes, losingTotal, r) => {
        const { pool, commission, paid, platformFinal } = settle({ stakes, losingTotal, ...r });
        expect(paid.plus(commission.boardmanAmount).plus(platformFinal).equals(pool)).toBe(true);
      }),
      { numRuns: 2000 }
    );
  });

  it('never pays out more than the distributable pool, and never gives anyone a negative amount', () => {
    fc.assert(
      fc.property(winningStakes, naira(1, 5_000_000_00), rates, (stakes, losingTotal, r) => {
        const { commission, payouts, paid, platformFinal } = settle({ stakes, losingTotal, ...r });
        expect(paid.lte(commission.distributablePool)).toBe(true);
        expect(payouts.every((p) => p.amount.gte(0))).toBe(true);
        expect(platformFinal.gte(0)).toBe(true);
      }),
      { numRuns: 2000 }
    );
  });

  it('every payout is kobo-precise and within one kobo of its exact pro-rata share', () => {
    fc.assert(
      fc.property(winningStakes, naira(1, 5_000_000_00), rates, (stakes, losingTotal, r) => {
        const { commission, payouts, winningTotal } = settle({ stakes, losingTotal, ...r });
        payouts.forEach((p, i) => {
          expect(p.amount.decimalPlaces()).toBeLessThanOrEqual(2);
          const exact = commission.distributablePool.times(stakes[i]).dividedBy(winningTotal);
          expect(exact.minus(p.amount).abs().lt(0.01)).toBe(true);
        });
      }),
      { numRuns: 2000 }
    );
  });

  it('regression: three equal winners splitting ₦0.02 are not paid ₦0.03 in total', () => {
    // Found by the property above: with half-up rounding each got ₦0.01,
    // and the platform's share went to -₦0.01 to cover it.
    const { commission, paid, platformFinal } = settle({
      stakes: [toDecimal('0.01'), toDecimal('0.01'), toDecimal('0.01')],
      losingTotal: toDecimal('0.01'),
      boardmanRate: 0.5,
      platformRate: 0,
    });
    expect(commission.distributablePool.toString()).toBe('0.02');
    expect(paid.lte(commission.distributablePool)).toBe(true);
    expect(platformFinal.gte(0)).toBe(true);
  });

  it('a bigger stake on the winning side never gets a smaller payout', () => {
    fc.assert(
      fc.property(winningStakes, naira(1, 5_000_000_00), rates, (stakes, losingTotal, r) => {
        const { payouts } = settle({ stakes, losingTotal, ...r });
        for (let i = 0; i < stakes.length; i += 1) {
          for (let j = 0; j < stakes.length; j += 1) {
            if (stakes[i].gt(stakes[j])) expect(payouts[i].amount.gte(payouts[j].amount)).toBe(true);
          }
        }
      }),
      { numRuns: 500 }
    );
  });
});
