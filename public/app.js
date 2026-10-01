const $ = (selector) => document.querySelector(selector);
const state = { cameras: [], servers: [], filter: 'all' };

async function getJson(path) { const response = await fetch(path); if (!response.ok) throw new Error(`Request failed: ${path}`); return response.json(); }

function cameraCard(camera) {
  const status = camera.state === 'attention' ? 'Attention' : camera.state === 'offline' ? 'Offline' : camera.state === 'quiet' ? 'Quiet' : 'Live';
  const disabled = camera.state === 'offline' ? ' disabled' : '';
  return `<article class="camera-card ${camera.state}" data-state="${camera.state}">
    <div class="camera-visual accent-${camera.accent}"><div class="visual-noise"></div><div class="timestamp">${camera.state === 'offline' ? 'NO SIGNAL' : 'LIVE · ${camera.updated}'}</div><div class="visual-center"><span class="camera-glyph">⌁</span><strong>${camera.state === 'offline' ? 'Source offline' : camera.name}</strong><small>${camera.zone}</small></div><div class="camera-footer"><span class="state-pill ${camera.state}"><i></i>${status}</span><span>${camera.people ? `◉ ${camera.people} people` : '◌ Clear'}</span></div></div>
    <div class="camera-meta"><div><strong>${camera.name}</strong><span>${camera.serverName}</span></div><button class="open-source${disabled}" ${camera.webViewUrl ? `data-url="${camera.webViewUrl}"` : ''} title="Open source in Xeoma">↗</button></div>
  </article>`;
}

function renderCameras() {
  const visible = state.cameras.filter((c) => state.filter === 'all' || c.state === state.filter);
  $('#camera-grid').innerHTML = visible.length ? visible.map(cameraCard).join('') : '<div class="empty-state">No cameras match this view.</div>';
  document.querySelectorAll('.open-source:not(.disabled)').forEach((button) => button.addEventListener('click', () => window.open(button.dataset.url, '_blank', 'noopener,noreferrer')));
}

function renderServers() {
  $('#server-list').innerHTML = state.servers.map((server) => `<div class="server-row"><span class="server-status ${server.status}"><i></i></span><div><strong>${server.name}</strong><small>${server.location || server.host}</small></div><span class="server-cameras">${server.cameras} cams</span><span class="latency">${server.latencyMs ? `${server.latencyMs} ms` : '—'}</span><button class="row-more">···</button></div>`).join('');
}

async function init() {
  try {
    const [meta, servers, cameras] = await Promise.all([getJson('/api/meta'), getJson('/api/servers'), getJson('/api/cameras')]);
    state.servers = servers.servers; state.cameras = cameras.cameras;
    $('#mode-chip').textContent = meta.demoMode ? 'DEMO MODE' : 'CONNECTED';
    $('#mode-chip').classList.toggle('connected', !meta.demoMode);
    $('#camera-count').textContent = state.cameras.length || '—';
    $('#online-count').innerHTML = `${state.servers.filter((s) => s.status === 'online').length} <small>/ ${state.servers.length}</small>`;
    $('#active-count').innerHTML = `${state.cameras.filter((c) => ['live', 'quiet'].includes(c.state)).length} <small>/ ${state.cameras.length}</small>`;
    $('#attention-count').textContent = state.cameras.filter((c) => c.state === 'attention' || c.state === 'offline').length;
    document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.filter').forEach((b) => b.classList.remove('active')); button.classList.add('active'); state.filter = button.dataset.filter; renderCameras(); }));
    renderCameras(); renderServers();
  } catch (error) { $('#camera-grid').innerHTML = `<div class="empty-state">Could not load the hub: ${error.message}</div>`; }
}
init();
