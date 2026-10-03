import test from 'node:test';
import assert from 'node:assert/strict';
import { createXeomaProvider } from '../src/server.js';

const secretServer = {
  id: 'site-4',
  name: 'Site 4',
  host: 'https://viewer:super-secret@xeoma-site-4.example.com/client',
  username: 'viewer',
  password: 'super-secret',
  webViewUrl: 'https://viewer:super-secret@xeoma-site-4.example.com/view/REPLACE'
};

function silenceConsole() {
  const original = { error: console.error, log: console.log, warn: console.warn, info: console.info };
  const lines = [];
  for (const method of Object.keys(original)) {
    console[method] = (...args) => lines.push(args.map((arg) => String(arg)).join(' '));
  }
  return {
    lines,
    restore() { Object.assign(console, original); }
  };
}

test('fast HTTPS 2xx is online and omits credentials', async () => {
  const calls = [];
  const logs = silenceConsole();
  try {
    const health = await createXeomaProvider(secretServer, {
      slowMs: 2000,
      timeoutMs: 500,
      fetch: async (url, init) => {
        calls.push({ url: String(url), method: init.method, redirect: init.redirect, hasSignal: Boolean(init.signal) });
        return new Response(null, { status: 204 });
      }
    }).health();
    assert.equal(health.status, 'online');
    assert.equal(health.reachable, true);
    assert.equal(health.httpStatus, 204);
    assert.equal(health.message, 'Reachable');
    assert.equal(health.host, 'https://xeoma-site-4.example.com');
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].redirect, 'manual');
    assert.equal(calls[0].hasSignal, true);
    assert.equal(calls[0].url.startsWith('https://xeoma-site-4.example.com/client'), true);
    assert.equal(JSON.stringify(calls).includes('super-secret'), false);
    assert.equal(JSON.stringify(calls).includes('viewer'), false);
    assert.equal(JSON.stringify(health).includes('super-secret'), false);
    assert.equal(JSON.stringify(health).includes('viewer'), false);
    assert.equal(logs.lines.join('\n').includes('super-secret'), false);
  } finally {
    logs.restore();
  }
});

test('slow 2xx and non-2xx map to attention', async () => {
  const slow = await createXeomaProvider(secretServer, {
    slowMs: 0,
    fetch: async () => new Response(null, { status: 200 })
  }).health();
  assert.equal(slow.status, 'attention');
  assert.equal(slow.reachable, true);
  assert.equal(slow.message, 'Slow response');

  const denied = await createXeomaProvider({ id: 'site-1', host: 'https://xeoma-site-1.example.com' }, {
    fetch: async () => new Response(null, { status: 503 })
  }).health();
  assert.equal(denied.status, 'attention');
  assert.equal(denied.httpStatus, 503);
  assert.equal(denied.message, 'HTTP 503');
});

test('timeout and TLS or network failures map to offline', async () => {
  const logs = silenceConsole();
  try {
    const timedOut = await createXeomaProvider({ id: 'site-2', host: 'https://xeoma-site-2.example.com', password: 'super-secret' }, {
      timeoutMs: 30,
      fetch: (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })
    }).health();
    assert.equal(timedOut.status, 'offline');
    assert.equal(timedOut.reachable, false);
    assert.equal(timedOut.message, 'Health check timed out');
    assert.equal(JSON.stringify(timedOut).includes('super-secret'), false);

    const tls = await createXeomaProvider({ id: 'site-3', host: 'https://xeoma-site-3.example.com', username: 'viewer' }, {
      fetch: async () => {
        const error = new TypeError('fetch failed');
        error.cause = { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' };
        throw error;
      }
    }).health();
    assert.equal(tls.status, 'offline');
    assert.equal(tls.message, 'Unreachable (network or TLS)');
    assert.equal(JSON.stringify(tls).includes('viewer'), false);
    assert.equal(logs.lines.join('\n').includes('super-secret'), false);
  } finally {
    logs.restore();
  }
});

test('non-HTTPS hosts are not requested', async () => {
  let called = false;
  const health = await createXeomaProvider({ id: 'site-1', host: 'http://xeoma-site-1.example.com' }, {
    fetch: async () => { called = true; return new Response(null, { status: 200 }); }
  }).health();
  assert.equal(called, false);
  assert.equal(health.status, 'attention');
  assert.match(health.message, /https/);
});
