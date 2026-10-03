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
  assert.equal(camerasRes.body.includes('super-secret'), false);
  assert.equal(camerasRes.body.includes('"username"'), false);
  assert.equal(camerasRes.body.includes('"password"'), false);

  const meta = JSON.parse((await request('/api/meta')).body);
  assert.equal(meta.demoMode, false);
  assert.equal(meta.configError, null);
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

test.after(() => server.close());
