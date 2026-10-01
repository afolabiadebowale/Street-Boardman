// Client error tracking (TASK-042). The Sentry SDK is only downloaded when
// VITE_SENTRY_DSN was set at build time — a build without it ships none
// of the SDK, which matters for users on metered mobile data.
const dsn = import.meta.env.VITE_SENTRY_DSN;

let sentry = null;
const pending = [];

export function initErrorTracking() {
  if (!dsn) return;
  import('./sentryClient.js').then((Sentry) => {
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      release: import.meta.env.VITE_SENTRY_RELEASE,
      sendDefaultPii: false,
    });
    sentry = Sentry;
    for (const [error, context] of pending.splice(0)) send(error, context);
  });
}

function send(error, context) {
  sentry.withScope((scope) => {
    if (context?.requestId) scope.setTag('requestId', context.requestId);
    if (context) scope.setExtras(context);
    sentry.captureException(error);
  });
}

export function captureException(error, context) {
  if (!dsn) return;
  if (sentry) send(error, context);
  else pending.push([error, context]);
}
