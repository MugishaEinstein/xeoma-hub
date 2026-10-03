import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfiguredServers, isRawIpAddress } from '../src/server.js';

function withConfig(entries) {
  const previous = process.env.XEOMA_SERVERS_JSON;
  process.env.XEOMA_SERVERS_JSON = JSON.stringify(entries);
  try {
    return loadConfiguredServers();
  } finally {
    if (previous == null) delete process.env.XEOMA_SERVERS_JSON;
    else process.env.XEOMA_SERVERS_JSON = previous;
  }
}

test('recognizes raw IP addresses and not hostnames', () => {
  assert.equal(isRawIpAddress('203.0.113.10'), true);
  assert.equal(isRawIpAddress('[2001:db8::10]'), true);
  assert.equal(isRawIpAddress('2001:db8::10'), true);
  assert.equal(isRawIpAddress('::1'), true);
  assert.equal(isRawIpAddress('xeoma-site-4.example.com'), false);
  assert.equal(isRawIpAddress('999.999.999.999'), false);
});

test('dynamic raw IPv4 and IPv6 endpoints are rejected', () => {
  const ipv4 = withConfig([{
    id: 'site-4',
    name: 'Site 4',
    network: 'dynamic',
    host: 'https://viewer:super-secret@203.0.113.10:8443/client',
    webViewUrl: 'https://xeoma-site-4.example.com/view/REPLACE',
    password: 'super-secret'
  }]);
  assert.equal(ipv4.servers.length, 0);
  assert.match(ipv4.configError, /Site 4/);
  assert.match(ipv4.configError, /host is a raw IP address \(203\.0\.113\.10\)/);
  assert.match(ipv4.configError, /tunnel or DDNS hostname/i);
  assert.equal(ipv4.configError.includes('super-secret'), false);

  const ipv6 = withConfig([{
    id: 'site-4',
    name: 'Site 4',
    network: 'dynamic',
    host: 'https://xeoma-site-4.example.com',
    webViewUrl: 'https://[2001:db8::10]/view/REPLACE'
  }]);
  assert.match(ipv6.configError, /webViewUrl is a raw IP address \(2001:db8::10\)/);
  assert.match(ipv6.configError, /tunnel or DDNS/i);
});

test('static or unspecified raw IPs warn, hostnames do not', () => {
  const warned = withConfig([{
    id: 'site-1',
    name: 'Site 1',
    network: 'static',
    host: '203.0.113.20',
    webViewUrl: 'https://xeoma-site-1.example.com/view/REPLACE'
  }]);
  assert.equal(warned.configError, null);
  assert.equal(warned.servers.length, 1);
  assert.match(warned.configWarnings[0], /raw IP address \(203\.0\.113\.20\)/);
  assert.match(warned.servers[0].configWarnings[0], /tunnel or DDNS/i);

  const omitted = withConfig([{
    id: 'site-2',
    host: 'https://198.51.100.8/client',
    webViewUrl: 'https://198.51.100.8/view/REPLACE'
  }]);
  assert.equal(omitted.configError, null);
  assert.equal(omitted.configWarnings.length, 2);

  const dynamicName = withConfig([{
    id: 'site-4',
    name: 'Site 4',
    network: 'dynamic',
    host: 'https://xeoma-site-4.example.com',
    webViewUrl: 'https://xeoma-site-4.example.com/view/REPLACE'
  }]);
  assert.equal(dynamicName.configError, null);
  assert.deepEqual(dynamicName.configWarnings, []);
  assert.deepEqual(dynamicName.servers[0].configWarnings, []);
});

test('invalid network values are rejected', () => {
  const loaded = withConfig([{ id: 'site-1', network: 'dhcp', host: 'https://xeoma-site-1.example.com' }]);
  assert.match(loaded.configError, /invalid network/);
  assert.equal(loaded.servers.length, 0);
});
