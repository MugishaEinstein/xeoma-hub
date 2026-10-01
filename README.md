# Xeoma Hub

A secure control-plane dashboard for aggregating multiple Xeoma deployments into one manager-friendly view.

> **Status:** working starter system with a polished demo dashboard, API surface, config-driven server inventory, and a server-side adapter boundary for the exact Xeoma API available in your licensed deployment.

![Xeoma Hub dashboard](https://placehold.co/1200x650/101817/b7e875?text=Xeoma+Hub)

## What it does

- Presents one camera wall across multiple sites.
- Shows server health, camera state, latency, and activity context.
- Keeps Xeoma credentials on the server; the browser receives redacted server records.
- Opens configured Xeoma browser-view URLs in a separate tab.
- Runs in demo mode out of the box so the UI can be reviewed before connecting real servers.

## Run locally

```bash
cp .env.example .env
npm start
# open http://localhost:4173
```

Run checks:

```bash
npm test
```

## Connect real Xeoma servers

Set `XEOMA_DEMO_MODE=false` and configure `XEOMA_SERVERS_JSON` with a JSON array. Example:

```json
[
  {
    "id": "warehouse",
    "name": "Warehouse",
    "location": "Entebbe · Logistics",
    "host": "https://xeoma.example.com",
    "username": "viewer",
    "password": "put-this-in-.env-only",
    "webViewUrl": "https://xeoma.example.com/view/your-webserver-link"
  }
]
```

Xeoma’s official documentation describes:

- **Multi-server mode** for viewing cameras and archive recordings from several servers.
- **Web API** for live video, stills, archive exports, and camera/module operations.
- **Pro JSON API** for richer chain, archive, and user-management operations.

The current adapter intentionally stops at the provider boundary because the exact endpoint/auth details depend on the installed Xeoma edition and how each Web Server module is configured. Implement `createXeomaProvider()` in `src/server.js` against the documented API for your environment, then add camera discovery and snapshot/archive routes.

## Production notes

1. Put the hub behind HTTPS and company SSO/reverse proxy.
2. Use a read-only Xeoma user for manager viewing.
3. Keep `XEOMA_SERVERS_JSON` in a secret manager or protected environment file.
4. Do not expose Xeoma hosts directly to the public internet without network controls.
5. Add audit logging before enabling management actions.

## Sources

- [Xeoma APIs and SDK integration](https://felenasoft.com/xeoma/en/articles/api-sdk-integration/)
- [Xeoma remote access options](https://felenasoft.com/xeoma/en/articles/remote-access/)
- [Xeoma API overview](https://felenasoft.com/xeoma/en/articles/api/)
