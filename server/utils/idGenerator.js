// Bet codes come from a Postgres sequence. They used to be
// `count(bets) + 1`, which gave every concurrent bet the same code: under
// load (200 bettors on one match) 44% of bets failed with a unique-
// constraint 500 even after retries, and deleting any bet would have made
// codes collide permanently. nextval() is atomic and never repeats. A
// rolled-back bet leaves a gap in the numbering, which is harmless.
async function generateBetCode(client) {
  const [{ n }] = await client.$queryRaw`SELECT nextval('bet_code_seq') AS n`;
  return `SB-${String(n).padStart(6, '0')}`;
}

module.exports = { generateBetCode };
