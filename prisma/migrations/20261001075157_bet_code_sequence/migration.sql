-- Bet codes (SB-000123) now come from a sequence instead of
-- count(bets) + 1, which handed concurrent bets the same code (see
-- server/utils/idGenerator.js). Starts after the highest existing code so
-- no ticket number is ever reissued.
CREATE SEQUENCE IF NOT EXISTS "bet_code_seq";

SELECT setval(
  '"bet_code_seq"',
  COALESCE(
    (SELECT MAX(CAST(SUBSTRING("betCode" FROM 4) AS BIGINT)) FROM "Bet" WHERE "betCode" ~ '^SB-[0-9]+$'),
    0
  ) + 1,
  false
);
