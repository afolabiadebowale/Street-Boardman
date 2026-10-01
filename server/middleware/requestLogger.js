const crypto = require('crypto');
const pinoHttp = require('pino-http');
const logger = require('../utils/logger');
const { runWithContext } = require('../utils/requestContext');

// An upstream load balancer/proxy may already have assigned an ID — reuse
// it so one request can be followed across hops. Anything else is
// replaced: this value is written into every log line and a response
// header, so it must not be able to carry newlines or arbitrary text.
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  const id = incoming && VALID_REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  runWithContext({ requestId: id }, next);
}

const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => req.id,
  customLogLevel(req, res, err) {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  // Load balancer health probes every few seconds would drown everything else.
  autoLogging: { ignore: (req) => req.url === '/health' },
  // The defaults dump every request and response header on every line;
  // this keeps what's actually used when investigating an incident.
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      remoteAddress: req.remoteAddress,
      userAgent: req.headers['user-agent'],
    }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});

module.exports = { requestId, httpLogger };
