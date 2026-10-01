// Only ever loaded via dynamic import from errorTracking.js. Named static
// imports here let the bundler tree-shake the SDK down to what's used —
// importing the whole '@sentry/react' namespace dynamically pulls in
// replay, tracing, and everything else (~155 KB gzipped vs. this).
export { init, withScope, captureException } from '@sentry/react';
