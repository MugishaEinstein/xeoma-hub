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

function loadConfiguredServers() {
  const rawEnv = process.env.XEOMA_SERVERS_JSON;
  if (rawEnv == null || String(rawEnv).trim() === '') return { servers: [], configError: null };
  let parsed;
  try {
    parsed = JSON.parse(rawEnv);
  } catch {
    return { servers: [], configError: 'XEOMA_SERVERS_JSON is not valid JSON' };
  }
  if (!Array.isArray(parsed)) return { servers: [], configError: 'XEOMA_SERVERS_JSON must be a JSON array' };
  if (parsed.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) {
    return { servers: [], configError: 'XEOMA_SERVERS_JSON entries must be objects' };
  }
  const servers = parsed.map((entry, index) => {
    const webViewUrl = webViewUrlOf(entry);
    return {
      ...entry,
      id: String(entry.id || `server-${index + 1}`),
      name: String(entry.name || entry.id || `Server ${index + 1}`),
      status: 'configured',
      cameras: webViewUrl ? 1 : 0,
      lastSync: 'not synced',
      webViewUrl
    };
  });
  return { servers, configError: null };
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
  return safe;
}

function configuredCameras(servers) {
  return servers.filter((server) => server.webViewUrl).map((server) => ({
    id: `${server.id}-webview`,
    serverId: server.id,
    name: server.name,
    zone: server.location || 'Browser view',
    state: 'live',
    people: 0,
    updated: 'configured',
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
  return { ...camera, serverName: server?.name || camera.serverId, webViewUrl, streamConfigured: Boolean(webViewUrl) };
}

function createXeomaProvider(server) {
  // The installed Xeoma edition determines whether this uses Web API or Pro JSON API.
  // Keep the integration server-side: never send server.password to the browser.
  return {
    async health() { return { id: server.id, status: 'configured', host: server.host, reachable: null, message: 'Provider adapter pending licensed Xeoma API mapping' }; },
    async snapshot(cameraId) { return { cameraId, supported: false, message: 'Implement with Xeoma Web API snapshot endpoint for this deployment.' }; }
  };
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
    return json(res, 200, {
      app: 'Xeoma Hub',
      demoMode,
      provider: demoMode ? 'demo' : 'xeoma-server-adapter',
      generatedAt: new Date().toISOString(),
      configError: loaded.configError
    });
  }
  if (url.pathname === '/api/servers') return json(res, 200, { servers: loaded.servers.map(publicServer) });
  if (url.pathname === '/api/cameras') {
    const cameras = demoMode ? demoCameras : configuredCameras(loaded.servers);
    return json(res, 200, { cameras: cameras.map((camera) => cameraResponse(camera, lookupServers)) });
  }
  if (url.pathname.startsWith('/api/servers/') && url.pathname.endsWith('/health')) {
    const id = url.pathname.split('/')[3];
    const server = loaded.servers.find((s) => s.id === id);
    return server ? json(res, 200, await (demoMode ? { id, status: server.status, reachable: true } : createXeomaProvider(server).health())) : json(res, 404, { error: 'Server not found' });
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

export { server, demoServers, demoCameras, configuredServers, loadConfiguredServers, createXeomaProvider };
