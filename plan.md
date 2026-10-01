# Xeoma Hub implementation plan

## Product intent
A single control-plane dashboard for a manager to see multiple Xeoma deployments and jump into live/browser views without exposing Xeoma passwords to the browser.

## Integration decision
Xeoma documents a multi-server client mode for viewing multiple servers, a Web API for live video/stills/archive exports, and a Pro JSON API for richer control. This starter uses a provider boundary so deployments can begin in demo mode and add the exact Web API/JSON API contract for the installed Xeoma edition without rewriting the UI.

## Architecture
- `src/server.js`: dependency-free Node HTTP server, API routes, config parsing, provider boundary, demo data.
- `public/index.html`: semantic dashboard shell.
- `public/app.js`: dashboard state, filters, server/camera cards, activity feed.
- `public/styles.css`: dark operations-console design.
- `test/server.test.js`: API smoke tests.

## Security defaults
- Credentials are server-side only and loaded from environment variables.
- No passwords are returned by the API.
- Demo mode is on by default.
- Real deployment should put the hub behind HTTPS and a company SSO/reverse proxy, then implement a Xeoma provider using the exact licensed API available in that environment.

## Design direction
**Design movement:** editorial operations console with restrained industrial warmth.
**Principles:** high-signal status, calm hierarchy, generous negative space, and obvious trust boundaries.
**Palette:** ink navy for focus, warm paper for readability, electric lime for healthy telemetry, amber for attention.
**Layout:** asymmetric command rail + wide camera canvas rather than a centered card grid.
**Signature elements:** live pulse marker, telemetry ribbon, and mono metadata labels.
**Voice:** direct and operational. Example lines: “One view across every site.” “Open the source in Xeoma.”
