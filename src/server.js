import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const demoMode = String(process.env.XEOMA_DEMO_MODE ?? 'true').toLowerCase() !== 'false';

const demoServers = [
  { id: 'north-campus', name: 'North Campus', location: 'Kampala · Main site', host: 'demo://north-campus', status: 'online', latencyMs: 42, cameras: 6, lastSync: 'just now' },
  { id: 'warehouse', name: 'Warehouse', location: 'Entebbe · Logistics', host: 'demo://warehouse', status: 'online', latencyMs: 68, cameras: 4, lastSync: '2 min ago' },
  { id: 'retail-east', name: 'Retail East', location: 'Jinja · Store 04', host: 'demo://retail-east', status: 'attention', latencyMs: 188, cameras: 3, lastSync: '8 min ago' }
];

const demoCameras = [
  { id: 'north-gate', serverId: 'north-campus', name: 'North gate', zone: 'Perimeter', state: 'live', people: 3, updated: '12 sec ago', accent: 'lime' },
  { id: 'loading-bay', serverId: 'north-campus', name: 'Loading bay', zone: 'Operations', state: 'live', people: 1, updated: '18 sec ago', accent: 'blue' },
  { id: 'reception', serverId: 'north-campus', name: 'Reception', zone: 'Front of house', state: 'quiet', people: 0, updated: '24 sec ago', accent: 'purple' },
  { id: 'aisle-2', serverId: 'warehouse', name: 'Aisle 2', zone: 'Inventory', state: 'live', people: 4, updated: '32 sec ago', accent: 'amber' },
  { id: 'dispatch', serverId: 'warehouse', name: 'Dispatch desk', zone: 'Operations', state: 'quiet', people: 0, updated: '40 sec ago', accent: 'teal' },
  { id: 'cashier', serverId: 'retail-east', name: 'Cashier', zone: 'Customer floor', state: 'attention', people: 2, updated: '8 min ago', accent: 'red' },
  { id: 'back-door', serverId: 'retail-east', name: 'Back door', zone: 'Perimeter', state: 'offline', people: 0, updated: '8 min ago', accent: 'slate' }
];

function webViewUrlOf(entry) {
  return typeof entry?.webViewUrl === 'string' && entry.webViewUrl.trim() ? entry.webViewUrl.trim() : null;
}

const HEALTH_TIMEOUT_MS = 5000;
const HEALTH_SLOW_MS = 2000;
const DYNAMIC_IP_HINT = 'Use a stable tunnel or DDNS hostname instead of a raw IP.';
const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4_RE = new RegExp(`^${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}$`);

function isRawIpAddress(hostname) {
  if (typeof hostname !== 'string') return false;
  let bare = hostname.trim().toLowerCase();
  if (bare.startsWith('[') && bare.endsWith(']')) bare = bare.slice(1, -1);
  if (IPV4_RE.test(bare)) return true;
  const mapped = bare.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped && IPV4_RE.test(mapped[1])) return true;
  if (!bare.includes(':') || !/^[0-9a-f:]+$/.test(bare)) return false;
  const compressed = bare.includes('::');
  if (compressed && bare.indexOf('::') !== bare.lastIndexOf('::')) return false;
  const parts = bare.split(':');
  if (!compressed && parts.length !== 8) return false;
  if (compressed && (parts.length < 3 || parts.length > 8)) return false;
  return parts.every((part) => part === '' || /^[0-9a-f]{1,4}$/.test(part));
}

function endpointUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  let candidate = trimmed;
  if (!hasScheme) {
    if (trimmed.startsWith('[')) candidate = `https://${trimmed}`;
    else if (trimmed.includes(':') && !/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(trimmed)) candidate = `https://[${trimmed}]`;
    else candidate = `https://${trimmed}`;
  }
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

function endpointHostname(value) {
  const url = endpointUrl(value);
  if (!url) return null;
  let hostname = url.hostname;
  if (hostname.startsWith('[') && hostname.endsWith(']')) hostname = hostname.slice(1, -1);
  return hostname.toLowerCase();
}

function withoutUserinfo(value) {
  if (typeof value !== 'string') return value ?? null;
  if (!value.includes('://')) return value;
  try {
    const url = new URL(value.trim());
    if (!url.username && !url.password) return value;
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return value.replace(/\/\/(?:[^/@\s]+)@/g, '//');
  }
}

function hostnameIssues(entry) {
  const errors = [];
  const warnings = [];
  const label = String(entry?.name || entry?.id || 'server');
  const network = entry?.network;
  if (network != null && network !== 'static' && network !== 'dynamic') {
    errors.push(`Server "${label}" has invalid network "${String(network)}". Use "static" or "dynamic".`);
  }
  for (const field of ['host', 'webViewUrl']) {
    const value = entry?.[field];
    if (typeof value !== 'string' || !value.trim()) continue;
    const hostname = endpointHostname(value);
    if (!hostname || !isRawIpAddress(hostname)) continue;
    const detail = `Server "${label}" ${field} is a raw IP address (${hostname}). ${DYNAMIC_IP_HINT}`;
    if (network === 'dynamic') errors.push(detail);
    else warnings.push(detail);
  }
  return { errors, warnings };
}

function emptyConfig(configError = null) {
  return { servers: [], configError, configWarnings: [] };
}

function loadConfiguredServers() {
  const rawEnv = process.env.XEOMA_SERVERS_JSON;
  if (rawEnv == null || String(rawEnv).trim() === '') return emptyConfig();
  let parsed;
  try {
    parsed = JSON.parse(rawEnv);
  } catch {
    return emptyConfig('XEOMA_SERVERS_JSON is not valid JSON');
  }
  if (!Array.isArray(parsed)) return emptyConfig('XEOMA_SERVERS_JSON must be a JSON array');
  if (parsed.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) {
    return emptyConfig('XEOMA_SERVERS_JSON entries must be objects');
  }
  const issues = parsed.map((entry) => hostnameIssues(entry));
  const errors = issues.flatMap((issue) => issue.errors);
  if (errors.length) return emptyConfig(errors.join(' '));
  const configWarnings = issues.flatMap((issue) => issue.warnings);
  const servers = parsed.map((entry, index) => {
    const webViewUrl = webViewUrlOf(entry);
    return {
      ...entry,
      id: String(entry.id || `server-${index + 1}`),
      name: String(entry.name || entry.id || `Server ${index + 1}`),
      status: 'configured',
      cameras: webViewUrl ? 1 : 0,
      lastSync: 'not synced',
      webViewUrl,
      configWarnings: issues[index].warnings
    };
  });
  return { servers, configError: null, configWarnings };
}

function configuredServers() {
  const loaded = loadConfiguredServers();
  if (loaded.configError) {
    const error = new Error(loaded.configError);
    error.code = 'XEOMA_CONFIG';
    throw error;
  }
  return loaded.servers;
}

function publicServer(server) {
  const { password, username, ...safe } = server;
  if (typeof safe.host === 'string') safe.host = withoutUserinfo(safe.host);
  if (typeof safe.webViewUrl === 'string') safe.webViewUrl = withoutUserinfo(safe.webViewUrl);
  return safe;
}

function configuredCameraState(server) {
  if (server.status === 'offline') return 'offline';
  if (server.status === 'attention') return 'attention';
  return 'live';
}

function configuredCameras(servers) {
  return servers.filter((server) => server.webViewUrl).map((server) => ({
    id: `${server.id}-webview`,
    serverId: server.id,
    name: server.name,
    zone: server.location || 'Browser view',
    state: configuredCameraState(server),
    people: 0,
    updated: server.status === 'online' ? 'reachable' : (server.status || 'configured'),
    accent: 'blue',
    webViewUrl: server.webViewUrl
  }));
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function safePublicPath(urlPath) {
  const pathname = urlPath === '/' ? '/index.html' : urlPath;
  const candidate = normalize(join(PUBLIC, pathname));
  return candidate.startsWith(PUBLIC) ? candidate : null;
}

async function serveStatic(req, res) {
  const file = safePublicPath(new URL(req.url, `http://${req.headers.host}`).pathname);
  if (!file || !existsSync(file)) return json(res, 404, { error: 'Not found' });
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
  res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
  res.end(await readFile(file));
}

function cameraResponse(camera, servers) {
  const server = servers.find((s) => s.id === camera.serverId);
  const webViewUrl = camera.webViewUrl || server?.webViewUrl || null;
  return { ...camera, serverName: server?.name || camera.serverId, webViewUrl: withoutUserinfo(webViewUrl), streamConfigured: Boolean(webViewUrl) };
}

function createXeomaProvider(server, options = {}) {
  // The installed Xeoma edition determines whether this uses Web API or Pro JSON API.
  // Health is a credential-free HTTPS GET of server.host. Never log or embed username/password.
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : HEALTH_TIMEOUT_MS;
  const slowMs = Number.isFinite(options.slowMs) ? options.slowMs : HEALTH_SLOW_MS;
  return {
    async health() {
      const id = server?.id;
      const started = Date.now();
      const base = { id, host: null, reachable: false, latencyMs: null, httpStatus: null };
      const rawHost = typeof server?.host === 'string' ? server.host.trim() : '';
      if (!rawHost) return { ...base, status: 'offline', message: 'No host configured' };
      const url = endpointUrl(rawHost);
      if (!url) return { ...base, status: 'offline', message: 'Host is not a valid URL' };
      url.username = '';
      url.password = '';
      url.hash = '';
      const safeHost = url.origin;
      if (url.protocol !== 'https:') {
        return { ...base, host: safeHost, status: 'attention', reachable: false, message: 'Health check requires an https:// host' };
      }
      if (typeof fetchImpl !== 'function') {
        return { ...base, host: safeHost, status: 'offline', message: 'Health check unavailable' };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url.toString(), { method: 'GET', redirect: 'manual', signal: controller.signal });
        const latencyMs = Date.now() - started;
        const httpStatus = response.status;
        try { await response.body?.cancel?.(); } catch { /* ignore unread health body */ }
        if (httpStatus >= 200 && httpStatus < 300) {
          if (latencyMs >= slowMs) {
            return { ...base, host: safeHost, status: 'attention', reachable: true, latencyMs, httpStatus, message: 'Slow response' };
          }
          return { ...base, host: safeHost, status: 'online', reachable: true, latencyMs, httpStatus, message: 'Reachable' };
        }
        return { ...base, host: safeHost, status: 'attention', reachable: true, latencyMs, httpStatus, message: `HTTP ${httpStatus}` };
      } catch (error) {
        const name = error && typeof error === 'object' ? error.name : '';
        const timedOut = name === 'AbortError' || name === 'TimeoutError';
        return {
          ...base,
          host: safeHost,
          status: 'offline',
          reachable: false,
          latencyMs: Date.now() - started,
          message: timedOut ? 'Health check timed out' : 'Unreachable (network or TLS)'
        };
      } finally {
        clearTimeout(timer);
      }
    },
    async snapshot(cameraId) { return { cameraId, supported: false, message: 'Implement with Xeoma Web API snapshot endpoint for this deployment.' }; }
  };
}

const healthInflight = new Map();

function healthFor(server) {
  const safeHost = withoutUserinfo(typeof server?.host === 'string' ? server.host : '') || '';
  const key = `${server?.id || ''}\n${safeHost}`;
  let pending = healthInflight.get(key);
  if (!pending) {
    pending = createXeomaProvider(server).health().finally(() => {
      if (healthInflight.get(key) === pending) healthInflight.delete(key);
    });
    healthInflight.set(key, pending);
  }
  return pending;
}

async function applyHealth(servers) {
  return Promise.all(servers.map(async (server) => {
    const health = await healthFor(server);
    return {
      ...server,
      status: health.status,
      latencyMs: health.latencyMs,
      lastSync: health.reachable ? 'just now' : 'unreachable'
    };
  }));
}

function configProblem(res, configError) {
  return json(res, 500, { error: configError });
}

async function handleApi(req, res, url) {
  const loaded = demoMode ? { servers: demoServers, configError: null } : loadConfiguredServers();
  const lookupServers = demoMode ? [...demoServers, ...loadConfiguredServers().servers] : loaded.servers;
  const configuredRequest = !demoMode && (url.pathname === '/api/servers' || url.pathname === '/api/cameras' || url.pathname.startsWith('/api/servers/'));
  if (loaded.configError && configuredRequest) return configProblem(res, loaded.configError);

  if (url.pathname === '/api/meta') {
    const payload = {
      app: 'Xeoma Hub',
      demoMode,
      provider: demoMode ? 'demo' : 'xeoma-server-adapter',
      generatedAt: new Date().toISOString(),
      configError: loaded.configError
    };
    if (!demoMode) payload.configWarnings = loaded.configWarnings || [];
    return json(res, 200, payload);
  }
  if (url.pathname === '/api/servers') {
    const servers = demoMode ? loaded.servers : await applyHealth(loaded.servers);
    return json(res, 200, { servers: servers.map(publicServer) });
  }
  if (url.pathname === '/api/cameras') {
    if (demoMode) return json(res, 200, { cameras: demoCameras.map((camera) => cameraResponse(camera, lookupServers)) });
    const servers = await applyHealth(loaded.servers);
    return json(res, 200, { cameras: configuredCameras(servers).map((camera) => cameraResponse(camera, servers)) });
  }
  if (url.pathname.startsWith('/api/servers/') && url.pathname.endsWith('/health')) {
    const id = url.pathname.split('/')[3];
    const server = loaded.servers.find((s) => s.id === id);
    if (!server) return json(res, 404, { error: 'Server not found' });
    if (demoMode) return json(res, 200, { id, status: server.status, reachable: true });
    return json(res, 200, await healthFor(server));
  }
  return json(res, 404, { error: 'API route not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
    return await serveStatic(req, res);
  } catch (error) { console.error(error); json(res, 500, { error: 'Internal server error' }); }
});

if (process.env.NODE_ENV !== 'test') server.listen(PORT, HOST, () => console.log(`Xeoma Hub listening on http://${HOST}:${PORT} (${demoMode ? 'demo' : 'configured'} mode)`));

export { server, demoServers, demoCameras, configuredServers, loadConfiguredServers, createXeomaProvider, isRawIpAddress, endpointHostname };
