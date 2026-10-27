// Monthly statements and shareable bet tickets (A3).
const fc = require('fast-check');
const request = require('supertest');
const app = require('../../server/app');
const { resetDatabase, prisma } = require('../helpers/reset');
const { resetAuthLimiter, approvedBoardman, fundedBetter, openCompetition } = require('../helpers/fixtures');
const statementService = require('../../server/services/statementService');
const resultService = require('../../server/services/resultService');
const payoutService = require('../../server/services/payoutService');
const walletService = require('../../server/services/walletService');

beforeEach(async () => {
  await resetDatabase();
  await resetAuthLimiter();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const thisMonth = () => new Date(Date.now() + 3600000).toISOString().slice(0, 7); // Lagos month

function parseCsv(text) {
  return text.trim().split('\r\n').slice(1).map((line) => {
    const [date, type, description, amount, balance] = line.split(',');
    return { date, type, description, amount, balance };
  });
}

describe('Monthly statement (A3)', () => {
  it('lists the month\'s movements between opening and closing balances', async () => {
    const bm = await approvedBoardman();
    const competition = await openCompetition(bm);
    const b = await fundedBetter(5000);
    await b.agent.post('/api/bets').send({ betOptionId: competition.betOptions[0].id, stake: 1000 });

    const res = await b.agent.get(`/api/wallet/me/statement?month=${thisMonth()}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/streetboardman-statement-\d{4}-\d{2}\.csv/);
    const rows = parseCsv(res.text);
    expect(rows.map((r) => [r.type, r.amount, r.balance])).toEqual([
      ['OPENING_BALANCE', '', '0.00'],
      ['DEPOSIT', '5000.00', '5000.00'],
      ['BET_STAKE', '-1000.00', '4000.00'],
      ['CLOSING_BALANCE', '', '4000.00'],
    ]);
  });

  it('carries the balance into a quiet month and validates the month', async () => {
    const b = await fundedBetter(2500);
    await prisma.walletTransaction.updateMany({ data: { createdAt: new Date('2026-01-15T12:00:00Z') } });

    const quiet = parseCsv((await b.agent.get('/api/wallet/me/statement?month=2026-02')).text);
    expect(quiet).toEqual([
      expect.objectContaining({ type: 'OPENING_BALANCE', balance: '2500.00' }),
      expect.objectContaining({ type: 'CLOSING_BALANCE', balance: '2500.00' }),
    ]);
    expect((await b.agent.get('/api/wallet/me/statement?month=2026-13')).status).toBe(422);
    expect((await b.agent.get('/api/wallet/me/statement')).status).toBe(422);
    expect((await b.agent.get('/api/wallet/me/statement?month=2099-01')).status).toBe(422);
    expect((await request(app).get(`/api/wallet/me/statement?month=${thisMonth()}`)).status).toBe(401);
  });

  it('always reconciles: opening + movements = closing, for random histories', async () => {
    const b = await fundedBetter(0);
    const wallet = await prisma.wallet.findUnique({ where: { userId: b.userId } });
    await fc.assert(
      fc.asyncProperty(fc.array(fc.integer({ min: -50000, max: 50000 }), { minLength: 0, maxLength: 12 }), async (kobos) => {
        for (const k of kobos) {
          try {
            await prisma.$transaction((tx) =>
              walletService.applyWalletTransaction(tx, {
                walletId: wallet.id,
                type: k >= 0 ? 'DEPOSIT' : 'WITHDRAWAL',
                delta: k / 100,
                referenceType: 'Test',
                referenceId: 'prop',
                counterparty: { type: 'EXTERNAL' },
              })
            );
          } catch (err) {
            // an overdraft is refused; skip it, as the app would
          }
        }
        const { opening, closing, csv } = await statementService.monthlyStatement(b.userId, thisMonth());
        const moved = parseCsv(csv)
          .filter((r) => r.amount !== '')
          .reduce((sum, r) => sum + Math.round(Number(r.amount) * 100), 0);
        expect(Math.round(Number(opening) * 100) + moved).toBe(Math.round(Number(closing) * 100));
      }),
      { numRuns: 15 }
    );
  });
});

describe('Shared bet tickets (A3)', () => {
  it('gives the owner one unguessable link that shows the bet but not who placed it', async () => {
    const bm = await approvedBoardman();
    const competition = await openCompetition(bm, 'Final: Tunde vs Seyi');
    const b = await fundedBetter(5000);
    const bet = (await b.agent.post('/api/bets').send({ betOptionId: competition.betOptions[0].id, stake: 1000 })).body.bet;

    const share = await b.agent.post(`/api/bets/${bet.betCode}/share`);
    expect(share.status).toBe(200);
    expect(share.body.shareToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(share.body.path).toBe(`/tickets/${share.body.shareToken}`);
    expect((await b.agent.post(`/api/bets/${bet.betCode}/share`)).body.shareToken).toBe(share.body.shareToken);

    const pub = await request(app).get(`/api/tickets/${share.body.shareToken}`);
    expect(pub.status).toBe(200);
    expect(pub.body.ticket).toMatchObject({
      betCode: bet.betCode,
      status: 'OPEN',
      stake: '1000',
      option: 'Tunde wins',
      competition: { title: 'Final: Tunde vs Seyi', status: 'BETTING_OPEN' },
      winningOption: null,
    });
    const text = JSON.stringify(pub.body);
    expect(text).not.toMatch(/Ada|phone|betterId|080/);
  });

  it('shows the outcome once the result is confirmed', async () => {
    const bm = await approvedBoardman();
    const competition = await openCompetition(bm);
    const b1 = await fundedBetter(5000);
    const b2 = await fundedBetter(5000);
    const bet = (await b1.agent.post('/api/bets').send({ betOptionId: competition.betOptions[0].id, stake: 1000 })).body.bet;
    await b2.agent.post('/api/bets').send({ betOptionId: competition.betOptions[1].id, stake: 1000 });
    const { shareToken } = (await b1.agent.post(`/api/bets/${bet.betCode}/share`)).body;

    await bm.agent.patch(`/api/competitions/${competition.id}/close-betting`);
    const profile = await prisma.boardmanProfile.findUnique({ where: { id: bm.profileId } });
    await resultService.submitResult(profile, competition.id, { winningOptionId: competition.betOptions[0].id });
    await prisma.result.update({ where: { competitionId: competition.id }, data: { status: 'CONFIRMED' } });
    await prisma.competition.update({ where: { id: competition.id }, data: { status: 'RESULT_CONFIRMED' } });
    await payoutService.processPayoutsForCompetition(competition.id);

    const pub = (await request(app).get(`/api/tickets/${shareToken}`)).body.ticket;
    expect(pub).toMatchObject({ status: 'WON', winningOption: 'Tunde wins', competition: { status: 'COMPLETED' } });
  });

  it('only the owner can share, and unknown or malformed tokens are 404', async () => {
    const bm = await approvedBoardman();
    const competition = await openCompetition(bm);
    const owner = await fundedBetter(5000);
    const other = await fundedBetter(5000);
    const bet = (await owner.agent.post('/api/bets').send({ betOptionId: competition.betOptions[0].id, stake: 1000 })).body.bet;

    expect((await other.agent.post(`/api/bets/${bet.betCode}/share`)).status).toBe(404);
    expect((await request(app).get('/api/tickets/AAAAAAAAAAAAAAAAAAAAAA')).status).toBe(404);
    expect((await request(app).get(`/api/tickets/${bet.betCode}`)).status).toBe(404);
  });
});
