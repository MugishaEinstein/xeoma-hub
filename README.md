# Xeoma Hub

Xeoma Hub is a secure control-plane dashboard for viewing multiple Xeoma deployments from one manager-friendly website. It keeps Xeoma credentials on the server, shows a camera wall and deployment health, and opens configured Xeoma browser-view links without storing video in the hub.

> **Current state:** the application runs in demo mode by default. Follow this guide to connect three sites with static public IPs and one site with a dynamic public IP.

> **Self-hosting on your static-IP machine:** follow [SELF_HOST_STATIC_IP.md](SELF_HOST_STATIC_IP.md) for the Docker Compose + Caddy deployment that publishes the Hub over HTTPS without exposing port 3000.

## 1. Recommended architecture

Use the hub as a **control plane**, not as a video recorder or a raw RTSP proxy:

```text
Manager browser
      |
      | HTTPS
      v
Permanent Xeoma Hub website
      |
      | server-side HTTPS calls / protected browser-view links
      +-------------------+-------------------+-------------------+-------------------+
      |                   |                   |                   |
 Site 1              Site 2              Site 3              Site 4
 static IP           static IP           static IP           dynamic IP
 Xeoma + Web API     Xeoma + Web API     Xeoma + Web API     Xeoma + tunnel/DDNS
```

The hub does **not** need direct access to Xeoma desktop ports. Expose only the Xeoma Web Server/API surface required for viewing and health checks. Keep archive storage and continuous recording at each site.

### Site inventory

| Site | Addressing | Recommended stable name | Connectivity recommendation |
|---|---|---|---|
| Site 1 | Static public IP | `xeoma-site-1.example.com` | DNS record to the static IP, HTTPS reverse proxy, viewer-only Xeoma account |
| Site 2 | Static public IP | `xeoma-site-2.example.com` | Same as Site 1 |
| Site 3 | Static public IP | `xeoma-site-3.example.com` | Same as Site 1 |
| Site 4 | Dynamic public IP | `xeoma-site-4.example.com` | Prefer an outbound Cloudflare Tunnel or equivalent; DDNS alone is only acceptable when the endpoint is separately protected with HTTPS and strong authentication |

**Best security option:** use the same outbound tunnel/VPN pattern for all four sites. Static IPs are useful for DNS and firewall allowlists, but they are not a substitute for TLS, authentication, or least-privilege access.

## 2. Prerequisites

- A domain you control, for example `example.com`.
- One stable hostname for every Xeoma site.
- A read-only Xeoma account for dashboard viewing.
- Xeoma Web Server modules configured for cameras that should be opened in a browser.
- A licensed Xeoma edition that supports the Web API or Pro JSON API for server-side health/discovery work.
- A TLS certificate at every public endpoint. Use a reverse proxy such as Caddy or Nginx, or an outbound tunnel provider that terminates HTTPS.
- Docker 24+ for self-hosting, or a managed container host.

Xeoma documents multi-server viewing, its Web API, and the Pro JSON API in the official references linked at the end of this file.

## 3. Prepare the three static-IP sites

Repeat these steps at each static-IP site.

### 3.1 DNS

Create an `A` record for the site hostname:

```text
xeoma-site-1.example.com  A  <SITE_1_STATIC_IP>
xeoma-site-2.example.com  A  <SITE_2_STATIC_IP>
xeoma-site-3.example.com  A  <SITE_3_STATIC_IP>
```

If your DNS provider supports proxying, proxying through the provider can hide the origin IP, but verify that the Xeoma browser-view/API behavior works through the proxy before relying on it.

### 3.2 Reverse proxy and TLS

Do not forward the Xeoma desktop/client port directly to the internet. Put the browser-facing Xeoma Web Server/API endpoint behind HTTPS. A minimal Caddy pattern is:

```caddyfile
xeoma-site-1.example.com {
    reverse_proxy 127.0.0.1:<LOCAL_XEOMA_WEB_PORT>
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
    }
}
```

Replace the local port with the port actually used by the Xeoma Web Server module. If the Xeoma endpoint is on another LAN host, use its private address instead of `127.0.0.1`.

If your hosted hub has a fixed outbound IP, allowlist that IP at the reverse proxy/firewall. If the hosted hub does not offer a fixed egress IP, use a tunnel with an access policy or mutual TLS instead of trying to maintain a fragile allowlist.

### 3.3 Xeoma configuration

For each camera that the manager should open:

1. Open the camera chain in Xeoma.
2. Add/configure the Xeoma **Web Server** module as required by your edition.
3. Confirm the browser-view URL works from a device outside the site network.
4. Use a read-only Xeoma user for the dashboard.
5. If using the Web API or Pro JSON API, confirm the exact endpoint and authentication method supported by that Xeoma edition.
6. Test one live view and one health/API request before adding the site to the hub.

## 4. Prepare the dynamic-IP site

A dynamic IP needs a stable public name and an outbound connection that survives address changes. **DDNS only updates the name; it does not secure the endpoint.**

### Preferred: outbound tunnel

Install an outbound tunnel connector at Site 4 and publish only the Xeoma Web Server/API endpoint through it:

```text
xeoma-site-4.example.com  HTTPS tunnel  ->  private Xeoma Web Server/API
```

Apply an access policy that permits only the hub’s server-side requests and authorized manager users. Keep the connector configured to start automatically after reboot, and monitor its connected/healthy state.

The tunnel endpoint must support the URLs used by your Xeoma browser-view modules. Some video transports do not work through every proxy, so verify live video, still snapshots, and archive playback separately.

### Alternative: DDNS plus hardened reverse proxy

If a tunnel is not possible:

1. Create a DDNS hostname such as `xeoma-site-4.example.com`.
2. Run a local updater at Site 4 so the hostname follows the changing public IP.
3. Terminate HTTPS at a reverse proxy.
4. Forward only the required HTTPS port to that reverse proxy.
5. Use a read-only Xeoma account and an additional access control layer where possible.
6. Confirm that the browser-view/API link remains valid after the ISP changes the IP.

Do not put the Xeoma service itself on an unauthenticated high-numbered port and do not rely on an IP address in the hub configuration for the dynamic site.

## 5. Configure the hub

Copy the environment template for a local or self-hosted deployment:

```bash
cp .env.example .env
```

Set demo mode off and configure one JSON record per site:

```dotenv
PORT=3000
HOST=0.0.0.0
XEOMA_DEMO_MODE=false
XEOMA_SERVERS_JSON=[{"id":"site-1","name":"Site 1","location":"Static IP site 1","host":"https://xeoma-site-1.example.com","username":"hub-viewer","password":"REPLACE_IN_SECRET_STORE","webViewUrl":"https://xeoma-site-1.example.com/view/REPLACE"},{"id":"site-2","name":"Site 2","location":"Static IP site 2","host":"https://xeoma-site-2.example.com","username":"hub-viewer","password":"REPLACE_IN_SECRET_STORE","webViewUrl":"https://xeoma-site-2.example.com/view/REPLACE"},{"id":"site-3","name":"Site 3","location":"Static IP site 3","host":"https://xeoma-site-3.example.com","username":"hub-viewer","password":"REPLACE_IN_SECRET_STORE","webViewUrl":"https://xeoma-site-3.example.com/view/REPLACE"},{"id":"site-4","name":"Site 4","location":"Dynamic IP site","host":"https://xeoma-site-4.example.com","username":"hub-viewer","password":"REPLACE_IN_SECRET_STORE","webViewUrl":"https://xeoma-site-4.example.com/view/REPLACE"}]
```

Important:

- Do not commit `.env` or real passwords.
- Prefer the hosting provider’s encrypted runtime secret store for `XEOMA_SERVERS_JSON`.
- Use a separate read-only Xeoma account for the hub, not an administrator account.
- Keep the `host` and `webViewUrl` values on HTTPS stable hostnames, not raw dynamic IPs.
- The current starter removes `username` and `password` from `/api/servers` responses before they reach the browser.

### Managed hosting configuration

For a managed container deployment, set these as runtime environment values/secrets rather than baking them into the image:

```text
XEOMA_DEMO_MODE=false
XEOMA_SERVERS_JSON=<the single-line JSON array>
```

The application listens on `0.0.0.0` and honors the platform-provided `PORT` value. The unauthenticated health endpoint is:

```text
GET /api/meta
```

It returns a small JSON response and is suitable for a container readiness check.

## 6. Run locally

```bash
cp .env.example .env   # optional; required for configured mode
npm start
# open http://localhost:3000
```

`npm start` and `npm run dev` load `.env` when that file exists (`--env-file-if-exists`) and still start if it is absent.

Run the smoke tests (`npm test` sets `NODE_ENV=test` so the server does not bind a port at import time):

```bash
npm test
```

## 7. Run with Docker

Build and start the hub:

```bash
docker build -t xeoma-hub .
docker run --rm \
  --name xeoma-hub \
  -p 3000:3000 \
  -e XEOMA_DEMO_MODE=true \
  xeoma-hub
```

For production, inject the real values through your secret manager:

```bash
docker run -d \
  --name xeoma-hub \
  --restart unless-stopped \
  -p 3000:3000 \
  -e XEOMA_DEMO_MODE=false \
  -e XEOMA_SERVERS_JSON="$XEOMA_SERVERS_JSON" \
  xeoma-hub
```

Put the hub itself behind HTTPS and company SSO/reverse proxy. Do not expose port 3000 directly to the public internet.

## 8. Validate each site before go-live

From the hub runtime environment, verify:

- `https://xeoma-site-N.example.com` resolves to the intended endpoint.
- The TLS certificate is valid and has the correct hostname.
- The read-only Xeoma credentials work.
- The configured browser-view URL opens a live stream.
- A still/snapshot request works if your integration uses it.
- Archive playback works if your integration exposes archive links.
- The dynamic site still resolves and streams after its ISP address changes.
- The hub reports the site as reachable without exposing credentials in browser devtools.

Then verify the dashboard:

```bash
curl -fsS https://YOUR_HUB_HOST/api/meta
curl -fsS https://YOUR_HUB_HOST/api/servers
curl -fsS https://YOUR_HUB_HOST/api/cameras
```

The first response should be `200`. The server response must not contain `password` or other secret fields.

## 9. Current integration boundary

The dashboard UI and server-side configuration boundary are implemented. The exact server-side Xeoma discovery/snapshot/archive calls still depend on the Xeoma edition and API contract installed at your sites. Implement the provider methods in `src/server.js` against the API available in your environment, then add camera discovery and snapshot/archive routes.

Configured mode (`XEOMA_DEMO_MODE=false`) now exposes each server that has a `webViewUrl` as a camera-wall card and as an Open control on the server row. Those links open the native Xeoma browser view. Invalid `XEOMA_SERVERS_JSON` is reported as `configError` on `GET /api/meta` and as HTTP 500 on `/api/servers` and `/api/cameras`. Camera discovery, snapshots, and archive calls are still pending the licensed Xeoma API.

## 10. Security checklist

- [ ] HTTPS is enabled for the hub and all four Xeoma endpoints.
- [ ] Site 4 uses a tunnel or hardened DDNS + reverse proxy; DDNS is not used as the only security measure.
- [ ] Xeoma hub credentials are read-only.
- [ ] No passwords are committed to GitHub, Docker layers, browser bundles, or logs.
- [ ] The hub is protected by company SSO or an equivalent access layer before sharing it with managers.
- [ ] Only required Xeoma Web Server/API routes are exposed.
- [ ] Static-site firewall rules are reviewed and logged.
- [ ] Tunnel/reverse-proxy health is monitored for all four sites.
- [ ] Archive retention remains at the individual Xeoma sites.
- [ ] Audit logging is added before enabling any remote management actions.

## Official Xeoma references

- [APIs and SDK integration](https://felenasoft.com/xeoma/en/articles/api-sdk-integration/)
- [Remote access options](https://felenasoft.com/xeoma/en/articles/remote-access/)
- [API overview](https://felenasoft.com/xeoma/en/articles/api/)
