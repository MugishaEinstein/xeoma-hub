# Self-host Xeoma Hub on a static-IP machine

This is the recommended deployment for your request: run Xeoma Hub on one machine with a static public IP, put a DNS name in front of it, and let Caddy terminate HTTPS automatically.

## Result

```text
Manager browser
      |
      | https://hub.example.com
      v
Static-IP machine
  Caddy :80/:443  ->  Xeoma Hub container :3000
                              |
                              +--> Site 1 Xeoma
                              +--> Site 2 Xeoma
                              +--> Site 3 Xeoma
                              +--> Site 4 Xeoma via tunnel/DDNS
```

The Hub container is not exposed directly. Only Caddy publishes ports 80 and 443.

## Requirements

- Ubuntu 22.04/24.04 or another Linux host that can run Docker Compose.
- A static public IP assigned to the host, or a router that forwards ports 80 and 443 to it.
- A DNS name such as `hub.example.com`.
- Docker Engine and the Docker Compose plugin.
- Outbound HTTPS access from this host to the four Xeoma endpoints.
- A read-only Xeoma account for the Hub.

If the static IP belongs to the same machine that runs one Xeoma server, keep the Hub on its internal port 3000 and make sure it does not conflict with Xeoma. Caddy owns public ports 80 and 443.

## 1. Point DNS to the static IP

Create an `A` record:

```text
hub.example.com  A  <YOUR_STATIC_PUBLIC_IP>
```

Wait for DNS to resolve from outside the site before starting Caddy. Caddy needs the hostname to request a trusted certificate.

Check from another network:

```bash
dig +short hub.example.com
```

The answer should be your static public IP.

## 2. Open only the required firewall ports

On the machine, allow SSH from your administration IP and public web traffic:

```bash
sudo ufw allow from <YOUR_ADMIN_IP> to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status verbose
```

Do **not** open port 3000 publicly. Do not open Xeoma’s desktop/client port just to make the Hub work. The Hub should reach the other sites over their protected HTTPS/Web API endpoints.

If there is an upstream router, forward TCP 80 and 443 to this machine. Keep router administration disabled from the internet.

## 3. Install Docker

On Ubuntu, install Docker using Docker’s official instructions for your Ubuntu release. Then verify:

```bash
docker --version
docker compose version
```

Add your deployment user to the Docker group only if your organization accepts the risk:

```bash
sudo usermod -aG docker "$USER"
# Log out and back in before using docker without sudo.
```

## 4. Install the Hub

Clone the private repository on the static-IP machine:

```bash
git clone https://github.com/MugishaEinstein/xeoma-hub.git
cd xeoma-hub
cp .env.selfhost.example .env
```

Edit `.env`:

```dotenv
HUB_DOMAIN=hub.example.com
HOST=0.0.0.0
PORT=3000
NODE_ENV=production
XEOMA_DEMO_MODE=true
XEOMA_SERVERS_JSON=[]
```

Start the demo first:

```bash
docker compose up -d --build
```

Check the containers and logs:

```bash
docker compose ps
docker compose logs --tail=100 hub
docker compose logs --tail=100 caddy
```

Open `https://hub.example.com`. Caddy should obtain the certificate automatically. The health endpoint is:

```bash
curl -fsS https://hub.example.com/api/meta
```

## 5. Connect the four Xeoma sites

After the demo works, update `.env` on the machine. Keep this file out of Git:

```dotenv
XEOMA_DEMO_MODE=false
XEOMA_SERVERS_JSON=[{"id":"site-1","name":"Site 1","location":"Static IP site 1","host":"https://xeoma-site-1.example.com","username":"hub-viewer","password":"REAL_SECRET","webViewUrl":"https://xeoma-site-1.example.com/view/REPLACE"},{"id":"site-2","name":"Site 2","location":"Static IP site 2","host":"https://xeoma-site-2.example.com","username":"hub-viewer","password":"REAL_SECRET","webViewUrl":"https://xeoma-site-2.example.com/view/REPLACE"},{"id":"site-3","name":"Site 3","location":"Static IP site 3","host":"https://xeoma-site-3.example.com","username":"hub-viewer","password":"REAL_SECRET","webViewUrl":"https://xeoma-site-3.example.com/view/REPLACE"},{"id":"site-4","name":"Site 4","location":"Dynamic IP site","host":"https://xeoma-site-4.example.com","username":"hub-viewer","password":"REAL_SECRET","webViewUrl":"https://xeoma-site-4.example.com/view/REPLACE"}]
```

Use stable HTTPS hostnames for the Xeoma sites. For Site 4, use the tunnel/DDNS hostname described in the main README rather than storing its changing raw IP.

Restart only the Hub after changing environment values:

```bash
docker compose up -d --build hub
```

## 6. Updates and rollback

Update the application from GitHub:

```bash
git fetch origin main
git checkout main
git pull --ff-only origin main
docker compose up -d --build hub
```

Caddy certificates and configuration are stored in Docker volumes, so rebuilding the Hub does not remove them. Check the result:

```bash
docker compose ps
docker compose logs --tail=100 hub
curl -fsS https://hub.example.com/api/meta
```

If an update is bad, return to the previous Git commit and rebuild:

```bash
git log --oneline -5
git checkout <KNOWN_GOOD_COMMIT>
docker compose up -d --build hub
```

## 7. Backups

Back up:

- The `.env` file, using encrypted storage and restricted permissions.
- The Docker Compose/Caddy files.
- The Caddy volumes if you need to preserve certificate state:

```bash
docker volume ls | grep xeoma
```

The Hub does not store Xeoma recordings. Recordings remain at the individual Xeoma sites.

## 8. Security checklist

- [ ] DNS `A` record points to the static public IP.
- [ ] HTTPS works and the certificate is valid.
- [ ] Only TCP 80/443 and restricted SSH are reachable from the internet.
- [ ] Port 3000 is not published by Docker or the firewall.
- [ ] `.env` has mode `600`: `chmod 600 .env`.
- [ ] A read-only Xeoma account is used.
- [ ] Site 4 uses a stable tunnel/DDNS hostname, not a raw changing IP.
- [ ] The Hub is placed behind company SSO or another access-control layer before broad sharing.
- [ ] Docker logs do not contain passwords or full `XEOMA_SERVERS_JSON` values.

## Troubleshooting

### Caddy certificate fails

Check DNS, upstream port forwarding, and firewall rules. Ports 80 and 443 must reach this host from the public internet. Inspect:

```bash
docker compose logs caddy
```

### The dashboard loads but Xeoma links do not

Test each Xeoma hostname from the Hub machine:

```bash
curl -I https://xeoma-site-1.example.com
```

Confirm the Xeoma Web Server module is configured, the URL is HTTPS, and the viewer account is valid.

### Port 80 or 443 is already in use

Find the process:

```bash
sudo ss -ltnp | grep -E ':80|:443'
```

Stop or reconfigure the existing web server, or place Caddy behind it and reverse proxy to the Hub container. Do not publish the Hub on a random unprotected port.
