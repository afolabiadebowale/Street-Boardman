const { Decimal } = require('@prisma/client/runtime/client');

function toDecimal(value) {
  return new Decimal(value);
}

// Rounds to 2 decimal places (kobo precision) using standard rounding.
function round2(decimal) {
  return new Decimal(decimal).toDecimalPlaces(2);
}

module.exports = { toDecimal, round2, Decimal };
