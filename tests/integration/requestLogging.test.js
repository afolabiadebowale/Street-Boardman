const { Writable } = require('stream');
const request = require('supertest');
const app = require('../../server/app');
const { resetDatabase, prisma } = require('../helpers/reset');
const logger = require('../../server/utils/logger');
const { buildLogger } = require('../../server/utils/logger');
const { getContext, runWithContext } = require('../../server/utils/requestContext');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function captureLogger() {
  const lines = [];
  const destination = new Writable({
    write(chunk, encoding, callback) {
      lines.push(JSON.parse(chunk.toString()));
      callback();
    },
  });
  return { log: buildLogger({ level: 'info', destination }), lines };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Request IDs (TASK-041)', () => {
  it('generates one and returns it when the caller sends none', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('reuses a well-formed ID from an upstream proxy', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'lb-trace.abc_123');
    expect(res.headers['x-request-id']).toBe('lb-trace.abc_123');
  });

  it('replaces an ID that could inject text into log lines', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'evil id" injected=true');
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('carries the request ID into logs written deep inside services', async () => {
    let contextAtLogTime;
    const spy = jest.spyOn(logger, 'info').mockImplementation((obj) => {
      if (obj && obj.event === 'demo_sms_otp') contextAtLogTime = getContext();
    });

    const res = await request(app).post('/api/otp/request').send({ phone: '08097770001', purpose: 'SIGNUP' });
    spy.mockRestore();

    expect(res.status).toBeLessThan(300);
    expect(contextAtLogTime).toEqual({ requestId: res.headers['x-request-id'] });
  });

  it('includes the request ID in a 500 response so support can find the log line', async () => {
    const { errorHandler } = require('../../server/middleware/errorHandler');
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })) };

    errorHandler(new Error('boom'), { id: 'req-42', method: 'GET', originalUrl: '/x' }, res, () => {});

    expect(res.status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'Something went wrong', requestId: 'req-42' });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('Structured log output (TASK-041)', () => {
  it('writes JSON lines stamped with the active request/job context', () => {
    const { log, lines } = captureLogger();

    runWithContext({ job: 'autoConfirmSweep', tickId: 't-1' }, () => log.info({ event: 'x' }, 'hello'));

    expect(lines[0]).toMatchObject({
      level: 30,
      msg: 'hello',
      event: 'x',
      job: 'autoConfirmSweep',
      tickId: 't-1',
      service: 'streetboardman',
    });
    expect(typeof lines[0].time).toBe('string');
  });

  it('redacts credentials at the top level and one level deep', () => {
    const { log, lines } = captureLogger();

    log.info({ pin: '1234', mfaSecret: 'S', user: { password: 'p', bvn: '12345678901', phone: '080' } }, 'x');

    expect(lines[0].pin).toBe('[REDACTED]');
    expect(lines[0].mfaSecret).toBe('[REDACTED]');
    expect(lines[0].user.password).toBe('[REDACTED]');
    expect(lines[0].user.bvn).toBe('[REDACTED]');
    expect(lines[0].user.phone).toBe('080');
  });

  it('redacts session cookies from logged request headers', () => {
    const { log, lines } = captureLogger();

    log.info({ req: { headers: { cookie: 'sb_access=secret', 'user-agent': 'ua' } } }, 'x');

    expect(lines[0].req.headers.cookie).toBe('[REDACTED]');
    expect(lines[0].req.headers['user-agent']).toBe('ua');
  });
});
