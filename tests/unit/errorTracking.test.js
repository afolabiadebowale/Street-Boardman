const Sentry = require('@sentry/node');
const AppError = require('../../server/utils/appError');
const { runWithContext } = require('../../server/utils/requestContext');

// Captures envelopes a real Sentry client would have sent over the network,
// so these tests assert on exactly what would leave the process (TASK-042).
function capturingTransport(sent) {
  return (options) =>
    Sentry.createTransport(options, async (request) => {
      const body = typeof request.body === 'string' ? request.body : Buffer.from(request.body).toString('utf8');
      for (const line of body.split('\n')) {
        if (!line) continue;
        const item = JSON.parse(line);
        if (item.exception || item.message) sent.push(item);
      }
      return { statusCode: 200 };
    });
}

describe('error tracking disabled (no SENTRY_DSN)', () => {
  it('is a silent no-op, so dev and tests never need a Sentry account', () => {
    jest.isolateModules(() => {
      const errorTracking = require('../../server/utils/errorTracking');
      expect(errorTracking.initErrorTracking({ dsn: '' })).toBe(false);
      expect(() => errorTracking.captureException(new Error('x'))).not.toThrow();
      expect(() => errorTracking.captureMessage('x')).not.toThrow();
    });
  });
});

describe('error tracking enabled (TASK-042)', () => {
  const sent = [];
  let errorTracking;
  let errorHandler;
  let logger;

  beforeAll(() => {
    errorTracking = require('../../server/utils/errorTracking');
    ({ errorHandler } = require('../../server/middleware/errorHandler'));
    logger = require('../../server/utils/logger');
    errorTracking.initErrorTracking({
      dsn: 'https://publickey@o0.ingest.sentry.io/0',
      transport: capturingTransport(sent),
    });
  });

  beforeEach(() => {
    sent.length = 0;
  });

  function fakeRes() {
    const json = jest.fn();
    return { status: jest.fn(() => ({ json })) };
  }

  it('sends unexpected errors, tagged with the request ID', async () => {
    jest.spyOn(logger, 'error').mockImplementation(() => {});
    runWithContext({ requestId: 'req-123' }, () => {
      errorHandler(new Error('db exploded'), { id: 'req-123', method: 'POST', originalUrl: '/api/bets' }, fakeRes(), () => {});
    });
    await errorTracking.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0].exception.values[0].value).toBe('db exploded');
    expect(sent[0].tags.requestId).toBe('req-123');
    expect(sent[0].extra).toMatchObject({ method: 'POST', url: '/api/bets' });
  });

  it('does not send operational errors (wrong PIN, validation) — only real bugs', async () => {
    errorHandler(new AppError('Invalid phone number or PIN', 401), { method: 'POST', originalUrl: '/api/auth/login' }, fakeRes(), () => {});
    await errorTracking.flush();

    expect(sent).toHaveLength(0);
  });

  it('tags worker sweep events with job and tickId', async () => {
    runWithContext({ job: 'autoConfirmSweep', tickId: 'tick-9' }, () => {
      errorTracking.captureMessage('Payout retries exhausted', { competitionId: 'c1' });
    });
    await errorTracking.flush();

    expect(sent[0].message).toBe('Payout retries exhausted');
    expect(sent[0].level).toBe('error');
    expect(sent[0].tags).toMatchObject({ job: 'autoConfirmSweep', tickId: 'tick-9' });
    expect(sent[0].extra.competitionId).toBe('c1');
  });

  it('scrubs credentials before anything leaves the process, without over-matching', async () => {
    errorTracking.captureException(new Error('x'), {
      pin: '1234',
      nested: { mfaSecret: 'S', bvn: '12345678901' },
      winningOptionId: 'opt-1',
    });
    await errorTracking.flush();

    expect(sent[0].extra.pin).toBe('[REDACTED]');
    expect(sent[0].extra.nested).toEqual({ mfaSecret: '[REDACTED]', bvn: '[REDACTED]' });
    expect(sent[0].extra.winningOptionId).toBe('opt-1');
  });

  it('drops request cookies and auth headers', () => {
    const event = errorTracking.beforeSend({
      request: {
        cookies: { sb_access: 'jwt' },
        headers: { Cookie: 'sb_access=jwt', Authorization: 'Bearer x', 'user-agent': 'ua' },
      },
    });

    expect(event.request.cookies).toBeUndefined();
    expect(event.request.headers).toEqual({ Cookie: '[REDACTED]', Authorization: '[REDACTED]', 'user-agent': 'ua' });
  });
});
