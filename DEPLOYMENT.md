# Deploying 1%

This app is a **single persistent Node.js server** with a **SQLite database on a persistent disk**. It is not compatible with serverless hosting, ephemeral filesystems, or multiple app replicas. The in-memory server-sent-event bus also assumes one server process.

## Hosting requirements

- Node.js **22.13 or newer** (the Docker image pins 22.13).
- One always-on process (no scale-to-zero, no serverless functions, no cluster replicas).
- A writable, persistent volume mounted at a stable path.
- HTTPS for a public deployment.
- A reverse proxy that preserves the original `Host` header and does not buffer `/api/events`.

Good fits: a small VPS with Docker, Fly.io, Railway, Render with a persistent disk, or any container host that supports a volume and a single instance.

## Environment variables

For a source deployment, put these in `.env.local` (loaded by `npm start` and `npm run backup`); real process environment variables take precedence. Container deployments pass them as container environment variables.

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_PATH` | Recommended | SQLite file on persistent storage. Defaults to `.data/one-percent.sqlite`. |
| `COOKIE_SECURE` | Yes on HTTPS | Set to `true` for a public HTTPS deployment so the session cookie is marked Secure. HSTS is sent on every response and is only honored by browsers over HTTPS. |
| `PORT` | No | Listen port. Defaults to `3000`. |
| `BIND_HOST` | No | Bind address for `npm start`. Defaults to `0.0.0.0`. |
| `HOSTNAME` | No | Bind address used by the standalone server and Docker image. The Docker image sets `0.0.0.0`. |

Do not commit `.env.local` or the database file.

## Source deployment

```sh
npm ci
npm run build
PORT=3000 COOKIE_SECURE=true npm start
```

`npm start` runs the standalone server produced by `npm run build`. Keep `node_modules` and `.next/` on the host, and point `DATABASE_PATH` at persistent storage. The build needs dev dependencies; the runtime does not run TypeScript.

## Docker

```sh
docker compose up -d --build
```

The compose file keeps the database in the `one-percent-data` volume and binds port 3000 to `127.0.0.1`. For a public host, put a TLS reverse proxy in front of port 3000 and start the app with `COOKIE_SECURE=true`:

```sh
COOKIE_SECURE=true docker compose up -d --build
```

Build and run without compose:

```sh
docker build -t one-percent .
docker run -d --name one-percent \
  -p 127.0.0.1:3000:3000 \
  -e COOKIE_SECURE=true \
  -v one-percent-data:/data \
  one-percent
```

The image includes a health check that calls `/api/health`. Its entrypoint fixes ownership of the mounted `/data` volume and then drops to the unprivileged `node` user before starting the server.

## Reverse proxy

### Caddy

Caddy obtains and renews TLS certificates automatically. `flush_interval -1` disables buffering for the event stream.

```caddyfile
app.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3000 {
    flush_interval -1
  }
}
```

### Nginx

```nginx
server {
  listen 443 ssl http2;
  server_name app.example.com;

  # ssl_certificate ...; ssl_certificate_key ...;

  location /api/events {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
  }

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
  }
}
```

If the proxy rewrites `Host` or strips the `Origin` header, POST requests will fail the same-origin check. Keep the original host and origin.

## Render

The repository includes `render.yaml`, a Render Blueprint for this app.

### Free plan (no payment method)

The Blueprint is configured for Render's **free** instance:

- Plan `free` (0.1 CPU / 512 MB) and region `singapore`
- Docker runtime, health check at `/api/health`
- `DATABASE_PATH=/app/.data/one-percent.sqlite` inside the container
- `COOKIE_SECURE=true`, `PORT=10000`

Free instances **cannot attach a persistent disk**. Render wipes the local filesystem on every redeploy, restart, and spin-down, so all accounts, tasks, parties, and sessions are lost. Render also sleeps a free service after 15 minutes without traffic and takes about a minute to wake it. Treat a free deployment as a demo, not as a home for real user data.

To deploy: **New + → Blueprint**, select the repository, and apply. No card is required for the free plan.

### Paid plan with a persistent disk (durable)

A persistent disk requires a paid instance. Change `render.yaml` back to a disk-backed service:

```yaml
    plan: 0.5c-512mb
    envVars:
      # ...
      - key: DATABASE_PATH
        value: /data/one-percent.sqlite
    disk:
      name: one-percent-data
      mountPath: /data
      sizeGB: 1
```

Notes:

- A persistent disk can be attached to only one instance, and Render does not allow scaling a service with a disk. Keep the service at one instance. Because the disk cannot be shared by old and new instances, Render stops the old instance before starting the new one during a deploy, so expect a few seconds of deployment downtime.
- The Docker image starts as root only for the entrypoint: it creates the database directory, fixes ownership, then drops to the unprivileged `node` user before starting the server. The same entrypoint also works without a disk.
- Add a custom domain in Render if you have one. Render provisions TLS automatically.
- `render.yaml` validates against Render's Blueprint schema. The image was built and run locally with a root-owned volume: the health check passed, the server ran as UID 1000, and SQLite data plus a session survived a container restart.

### Render backups (paid disk only)

Free instances have no Shell, so they cannot be backed up or restored through the app. On a disk-backed service, use the Render Shell to take a consistent SQLite snapshot:

```sh
node scripts/backup.mjs /data/backup-$(date +%F).sqlite
```

Then transfer the file off the disk. Render's Shell supports [Magic-Wormhole](https://render.com/docs/disks#magic-wormhole) for moving files to and from a disk-backed service. Copy backups to durable storage outside Render and test restores periodically.

Render automatically creates an encrypted snapshot of the disk once every 24 hours and retains it for seven days. Render recommends against restoring a disk snapshot for a custom database such as SQLite, because the database can restore to a corrupted state. Use the SQLite backup above for database recovery; treat Render snapshots as a last-resort disk recovery option.

## First deployment checklist

1. Build and start the server against the persistent volume.
2. Confirm `GET /api/health` returns `{"ok":true}`.
3. Create an account, add a task, log progress, and reload.
4. Create a party, create an invite, and accept it in a private browser window.
5. Verify live updates by logging progress in one window and watching the other.
6. Confirm `/api/events` stays open through the proxy (no buffering, reconnects after a restart).
7. Confirm the database file survives a container restart.
8. Set a backup schedule.
9. Confirm the app is served over HTTPS and that `COOKIE_SECURE=true`.

## Backups

SQLite runs in WAL mode. Stop the server before a filesystem copy, or use the SQLite-aware backup command:

```sh
npm run backup -- /path/to/backup.sqlite
```

With Docker:

```sh
docker compose exec app node scripts/backup.mjs /data/backup.sqlite
docker compose cp app:/data/backup.sqlite ./backup.sqlite
```

`VACUUM INTO` produces a consistent snapshot while the app is running. Copy the backup off the volume and verify restores periodically.

## Upgrades

1. Take a backup.
2. Stop the server. Building while it runs from `.next/standalone` can hit file locks on some platforms.
3. Replace the image or source.
4. Run `npm run build` (or rebuild the image).
5. Start the one server process.
6. Check `/api/health` and sign in.

Do not run old and new servers against the same database during a schema change. The current schema uses additive `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`, so it upgrades in place.

## Operational limits

- **One process only.** Multiple replicas break the in-memory SSE notifications and increase SQLite write contention.
- **No serverless.** The database and event streams require a long-lived process and disk.
- **Rate limiting is in-memory.** Limits reset on restart and are per process. That matches the single-process architecture.
- **Per-IP limits trust proxy headers.** Keep the Node port behind a trusted reverse proxy that overwrites `X-Real-IP`/`X-Forwarded-For`. A directly exposed port lets a client rotate those headers; app-wide and per-account caps still apply.
- **Account resource caps.** Accounts can own up to 20 parties, keep up to 2,000 task records (200 active), and each party can have up to 50 active invitations. Authenticated writes are rate limited per account.
- **No email delivery.** Email is an account identifier only; there is no verification or password reset.
- **Registration is open.** Rate limiting reduces abuse but does not replace an invitation system for accounts.
- **No account deletion.** Add it before handling regulated personal data.
