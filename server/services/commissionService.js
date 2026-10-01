const { toDecimal, round2, Decimal } = require('../utils/money');

// Given everything staked on a competition (every option combined), works
// out the Boardman's cut, the Platform's cut, and what's left to share
// among winners. Commission is taken off the TOP of the whole pool, not
// just the winning side — this is what funds the payout even when the
// favourite loses.
function calculateCommission(totalStakePool, boardmanRate, platformRate) {
  const pool = round2(toDecimal(totalStakePool));
  const boardmanAmount = round2(pool.times(boardmanRate));
  const platformAmount = round2(pool.times(platformRate));
  const distributablePool = round2(pool.minus(boardmanAmount).minus(platformAmount));
  return { totalStakePool: pool, boardmanAmount, platformAmount, distributablePool };
}

// Pari-mutuel split: each winning bet gets a share of the distributable
// pool proportional to its share of everything staked on the winning
// option. Example: distributablePool = 92,000, winning option total =
// 40,000, a bet of 5,000 on that option gets (5000/40000) * 92000 = 11,500.
//
// Each share is rounded DOWN to the kobo. Rounding half-up let the shares
// sum to more than the pool (e.g. three equal winners splitting ₦0.02 got
// ₦0.01 each), paying out money that wasn't there. Rounding down means
// payouts never exceed the pool; the leftover, under one kobo per winner,
// goes to the platform (see payoutService). Found by property tests,
// TASK-045.
function calculateWinnerPayouts(winningBets, winningOptionTotalStaked, distributablePool) {
  const optionTotal = toDecimal(winningOptionTotalStaked);
  if (optionTotal.lte(0)) return [];
  return winningBets.map((bet) => {
    const share = toDecimal(bet.stake).dividedBy(optionTotal);
    const amount = toDecimal(distributablePool).times(share).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    return { betId: bet.id, amount };
  });
}

module.exports = { calculateCommission, calculateWinnerPayouts };
