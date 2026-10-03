import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const sample = [
  {
    id: 'warehouse',
    name: 'Warehouse',
    host: 'https://xeoma.example.com',
    username: 'viewer',
    password: 'super-secret',
    webViewUrl: 'https://xeoma.example.com/view/warehouse',
    location: 'North campus'
  },
  {
    id: 'gate',
    name: 'Gate only',
    host: 'https://xeoma.example.com',
    username: 'viewer',
    password: 'super-secret',
    location: 'South gate'
  }
];

process.env.NODE_ENV = 'test';
process.env.XEOMA_DEMO_MODE = 'false';
process.env.XEOMA_SERVERS_JSON = JSON.stringify(sample);

const { server } = await import('../src/server.js');

globalThis.fetch = async () => new Response(null, { status: 200 });

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const testPort = server.address().port;

function request(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: testPort, path }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('configured mode exposes webViewUrl cards and hides credentials', async () => {
  const serversRes = await request('/api/servers');
  assert.equal(serversRes.status, 200);
  const serversBody = JSON.parse(serversRes.body);
  assert.equal(serversBody.servers.length, 2);
  assert.equal(serversBody.servers[0].webViewUrl, sample[0].webViewUrl);
  assert.equal(serversBody.servers[0].cameras, 1);
  assert.equal(serversBody.servers[0].status, 'online');
  assert.equal(typeof serversBody.servers[0].latencyMs, 'number');
  assert.deepEqual(serversBody.servers[0].configWarnings, []);
  assert.equal(Object.hasOwn(serversBody.servers[0], 'password'), false);
  assert.equal(Object.hasOwn(serversBody.servers[0], 'username'), false);
  assert.equal(Object.hasOwn(serversBody.servers[1], 'password'), false);
  assert.equal(serversRes.body.includes('super-secret'), false);
  assert.equal(serversRes.body.includes('viewer'), false);

  const camerasRes = await request('/api/cameras');
  assert.equal(camerasRes.status, 200);
  const cameras = JSON.parse(camerasRes.body).cameras;
  assert.equal(cameras.length, 1);
  assert.equal(cameras[0].webViewUrl, sample[0].webViewUrl);
  assert.equal(cameras[0].serverId, 'warehouse');
  assert.equal(cameras[0].serverName, 'Warehouse');
  assert.equal(cameras[0].streamConfigured, true);
  assert.equal(cameras[0].state, 'live');
  assert.equal(camerasRes.body.includes('super-secret'), false);
  assert.equal(camerasRes.body.includes('"username"'), false);
  assert.equal(camerasRes.body.includes('"password"'), false);

  const meta = JSON.parse((await request('/api/meta')).body);
  assert.equal(meta.demoMode, false);
  assert.equal(meta.configError, null);
  assert.deepEqual(meta.configWarnings, []);

  const healthRes = await request('/api/servers/warehouse/health');
  assert.equal(healthRes.status, 200);
  const health = JSON.parse(healthRes.body);
  assert.equal(health.status, 'online');
  assert.equal(health.reachable, true);
  assert.equal(healthRes.body.includes('super-secret'), false);
  assert.equal(healthRes.body.includes('viewer'), false);
});

test('invalid XEOMA_SERVERS_JSON is reported instead of an empty wall', async () => {
  process.env.XEOMA_SERVERS_JSON = '{not json';
  const meta = JSON.parse((await request('/api/meta')).body);
  assert.equal(meta.demoMode, false);
  assert.match(meta.configError, /not valid JSON/);

  const serversRes = await request('/api/servers');
  assert.equal(serversRes.status, 500);
  assert.match(JSON.parse(serversRes.body).error, /XEOMA_SERVERS_JSON/);

  const camerasRes = await request('/api/cameras');
  assert.equal(camerasRes.status, 500);
  assert.match(JSON.parse(camerasRes.body).error, /not valid JSON/);

  process.env.XEOMA_SERVERS_JSON = '{"id":"not-an-array"}';
  const nonArray = JSON.parse((await request('/api/meta')).body);
  assert.match(nonArray.configError, /JSON array/);
  assert.equal((await request('/api/cameras')).status, 500);

  process.env.XEOMA_SERVERS_JSON = JSON.stringify(sample);
});


test('configured health replaces status and never sends credentials', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method, redirect: init?.redirect });
    return new Response('nope', { status: 503 });
  };
  process.env.XEOMA_SERVERS_JSON = JSON.stringify([{
    id: 'site-1',
    name: 'Site 1',
    network: 'static',
    host: 'https://viewer:super-secret@xeoma-site-1.example.com/client',
    username: 'viewer',
    password: 'super-secret',
    webViewUrl: 'https://viewer:super-secret@xeoma-site-1.example.com/view/REPLACE',
    location: 'Static IP site 1'
  }]);

  const serversRes = await request('/api/servers');
  assert.equal(serversRes.status, 200);
  assert.equal(serversRes.body.includes('super-secret'), false);
  assert.equal(serversRes.body.includes('viewer'), false);
  const server = JSON.parse(serversRes.body).servers[0];
  assert.equal(server.status, 'attention');
  assert.equal(server.host.includes('@'), false);
  assert.equal(server.webViewUrl.includes('@'), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].redirect, 'manual');
  assert.equal(calls[0].url.includes('super-secret'), false);
  assert.equal(calls[0].url.includes('viewer'), false);
  assert.equal(calls[0].url.startsWith('https://xeoma-site-1.example.com/client'), true);

  const cameras = JSON.parse((await request('/api/cameras')).body).cameras;
  assert.equal(cameras[0].state, 'attention');
  assert.equal(cameras[0].webViewUrl.includes('super-secret'), false);

  process.env.XEOMA_SERVERS_JSON = JSON.stringify(sample);
  globalThis.fetch = async () => new Response(null, { status: 200 });
});

test('dynamic raw IPs are rejected and static raw IPs warn', async () => {
  process.env.XEOMA_SERVERS_JSON = JSON.stringify([{
    id: 'site-4',
    name: 'Site 4',
    network: 'dynamic',
    host: 'https://203.0.113.10',
    username: 'viewer',
    password: 'super-secret',
    webViewUrl: 'https://xeoma-site-4.example.com/view/REPLACE'
  }]);
  const rejected = await request('/api/servers');
  assert.equal(rejected.status, 500);
  assert.match(JSON.parse(rejected.body).error, /raw IP address/);
  assert.match(JSON.parse(rejected.body).error, /tunnel or DDNS/i);
  const meta = JSON.parse((await request('/api/meta')).body);
  assert.match(meta.configError, /203\.0\.113\.10/);
  assert.match(meta.configError, /tunnel or DDNS/i);

  process.env.XEOMA_SERVERS_JSON = JSON.stringify([{
    id: 'site-1',
    name: 'Site 1',
    network: 'static',
    host: 'https://203.0.113.11',
    webViewUrl: 'https://xeoma-site-1.example.com/view/REPLACE'
  }]);
  const warned = JSON.parse((await request('/api/servers')).body);
  assert.equal(warned.servers.length, 1);
  assert.equal(warned.servers[0].status, 'online');
  assert.match(warned.servers[0].configWarnings[0], /raw IP address/);
  assert.match(warned.servers[0].configWarnings[0], /tunnel or DDNS/i);
  const warnedMeta = JSON.parse((await request('/api/meta')).body);
  assert.equal(warnedMeta.configError, null);
  assert.equal(warnedMeta.configWarnings.length, 1);

  process.env.XEOMA_SERVERS_JSON = JSON.stringify(sample);
});

test.after(() => server.close());
