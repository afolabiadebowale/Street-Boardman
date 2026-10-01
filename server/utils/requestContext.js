const { AsyncLocalStorage } = require('async_hooks');

// Carries per-request (requestId) or per-job-tick (job, tickId) context
// through every await, so a log line written deep inside a service —
// e.g. a payout failure — is still attributable to the request or sweep
// that caused it, without threading a logger through every function.
const storage = new AsyncLocalStorage();

function getContext() {
  return storage.getStore();
}

function runWithContext(context, fn) {
  return storage.run(context, fn);
}

module.exports = { getContext, runWithContext };
