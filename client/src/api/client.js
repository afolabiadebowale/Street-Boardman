import { captureException } from '../errorTracking.js';

// Thin fetch wrapper. `credentials: 'include'` is what lets the browser
// send/receive the httpOnly session cookies the backend sets — without it,
// every request would look logged-out.
async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    // Same ID as the server's log line and Sentry event (TASK-041/042).
    err.requestId = res.headers.get('x-request-id');
    // 4xx is the user's input being rejected — expected. 5xx is a bug.
    if (res.status >= 500) {
      captureException(err, { requestId: err.requestId, status: res.status, method, path });
    }
    throw err;
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
};
