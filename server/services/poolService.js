const { toDecimal, round2 } = require('../utils/money');

// What a bettor sees about a live pool (FEAT-036) and the edge-case rules
// that apply to it right now (FEAT-038). Mirrors payoutService exactly:
//  - the winners split the pool minus both commissions, pro rata;
//  - if nobody backed the winning option, or every stake is on one
//    option, everyone is refunded and no commission is taken (TASK-007).
// "payoutPer100" is what ₦100 on an option would return if it won with
// the pool as it stands now. It moves as bets come in, so it's an
// estimate, never a promise.
function poolView(competition, betCounts = {}) {
  const options = competition.betOptions || [];
  const total = options.reduce((sum, o) => sum.plus(toDecimal(o.totalStaked)), toDecimal(0));
  const backed = options.filter((o) => toDecimal(o.totalStaked).gt(0));
  const keepRate = 1 - competition.boardmanCommissionRate - competition.platformCommissionRate;
  const distributable = total.times(keepRate);
  const oneSided = backed.length === 1;

  const optionViews = options.map((o) => {
    const staked = toDecimal(o.totalStaked);
    let payoutPer100 = null;
    if (oneSided && staked.gt(0)) payoutPer100 = '100.00'; // would be a full refund
    else if (staked.gt(0)) payoutPer100 = round2(distributable.times(100).dividedBy(staked)).toFixed(2);
    return {
      id: o.id,
      label: o.label,
      totalStaked: round2(staked).toFixed(2),
      share: total.gt(0) ? Number(staked.dividedBy(total).toFixed(4)) : 0,
      bets: betCounts[o.id] || 0,
      payoutPer100,
    };
  });

  const notices = [];
  if (total.isZero()) {
    notices.push({ code: 'EMPTY_POOL', message: 'The pot is empty — be the first to stake. Payouts appear once people start betting.' });
  } else if (oneSided) {
    notices.push({
      code: 'ONE_SIDED',
      message: 'Every stake in the pot so far is on one option. If it stays that way, everyone is refunded and no commission is taken.',
    });
  }
  if (!total.isZero() && backed.length < options.length) {
    notices.push({
      code: 'UNBACKED_OPTION',
      message: 'If an option nobody has backed wins, every stake in the pot is refunded and no commission is taken.',
    });
  }

  return {
    totalPool: round2(total).toFixed(2),
    commission: {
      boardmanRate: competition.boardmanCommissionRate,
      platformRate: competition.platformCommissionRate,
    },
    options: optionViews,
    notices,
    estimate: true,
  };
}

module.exports = { poolView };
