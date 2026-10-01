import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { server } from '../src/server.js';

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const testPort = server.address().port;

function request(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: testPort, path }, (res) => { let data = ''; res.on('data', (chunk) => { data += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: data })); });
    req.on('error', reject); req.end();
  });
}

test('health endpoint lists demo metadata', async () => {
  const response = await request('/api/meta');
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.app, 'Xeoma Hub');
  assert.equal(body.demoMode, true);
});

test('server endpoint never exposes credentials', async () => {
  const response = await request('/api/servers');
  assert.equal(response.status, 200);
  assert.equal(response.body.includes('password'), false);
  assert.equal(JSON.parse(response.body).servers.length, 3);
});

test('camera endpoint returns a camera wall payload', async () => {
  const response = await request('/api/cameras');
  assert.equal(response.status, 200);
  const cameras = JSON.parse(response.body).cameras;
  assert.equal(cameras.length, 7);
  assert.ok(cameras.every((camera) => camera.serverName));
});

test.after(() => server.close());
