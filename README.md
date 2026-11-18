# 1%

A real multi-user, mobile-friendly daily improvement tracker. Create your own yes/no, count, and duration tasks; share selected tasks in invite-only parties; and see friends' saved progress update live.

## Run locally

Requires **Node.js 22.13 or newer** and npm. The app uses Node's built-in SQLite driver; Node 22 prints an experimental SQLite warning.

```sh
npm install
npm run dev
```

Open **http://localhost:3000**, create an account, and add your first task. No cloud credentials, Docker, demo account, or seeded data is required.

Data persists in `.data/one-percent.sqlite`, not in browser local storage. `.data/` is ignored by Git. Restarting the app does not erase accounts, tasks, parties, or timer sessions.

For optional settings, copy `.env.example` to `.env.local`. `npm start` and `npm run backup` load it; real process environment variables take precedence. Never commit the database or private environment files.

On WSL, if edits made through Windows do not trigger a refresh, enable Watchpack polling:

```sh
WATCHPACK_POLLING=true npm run dev
```

## Use with friends

1. Create a party from **Party**.
2. Open **Party settings**, select **New invite**, and copy the link.
3. Your friend opens the link, creates an account or signs in, then explicitly accepts.
4. When creating a task, choose that party under **Visibility**. Existing private daily records are never published retroactively; sharing an existing private task starts with future days.
5. Open a member's card to see their shared tasks and history. Private tasks are excluded from shared completion percentages and totals.

A `localhost` invitation only works on the machine running the app. To use the app from separate devices, serve it at a hostname or reachable address all members can access, and create invitations from that address. Internet access requires hosting; no public deployment is provisioned by this repository.

## Tracking behavior

- **Yes/no:** mark done and undo.
- **Count:** custom units such as reps, pages, or glasses; quick increments, arbitrary additions, and total corrections.
- **Duration:** timer start/pause/resume and manual minutes; goals support minutes plus seconds.
- Schedule tasks daily, on selected weekdays, or once. Start/end dates and task ordering are supported. Each account can have up to 200 active tasks and 2,000 total task records (archived history still counts), own up to 20 parties, and each party can have up to 50 active invitations. Authenticated writes are rate limited per account.
- Daily completion gives each scheduled task equal weight and includes partial progress. Completion caps at 100%, but actual over-target quantities are retained.
- No scheduled tasks means "No tasks planned", not 0% or 100%.
- Editing preserves past daily targets and schedules. Pending edits are available in the task editor. A tracking-type change after logging starts tomorrow.
- Sharing starts with future days; existing private history is never published retroactively. Unsharing stops today's and future sharing, while days already shared remain visible to that party.
- Archive stops a task from tomorrow, retaining today and all historical records.
- Timers persist on the server across reloads and devices. Only one timer can run per account. Elapsed time is split at the account's local midnight, including daylight-saving transitions; a timer stops when its task is no longer scheduled.
- Each account has an IANA timezone. Timezone changes take effect at the next midnight in the previous timezone; previous records keep their original timezone.
- Weekly/monthly calendars distinguish future plans from recorded history. Rest days neither extend nor break task streaks. Different measurement units stay separate.
- Saving requires a connection. Offline forms retain entered values and do not claim that changes were saved. On reconnect, the app reloads authorized server state.

## Architecture

- **Next.js / React / TypeScript:** responsive interface and same-origin JSON APIs.
- **SQLite:** relational persistence, transactions, versioned task definitions, daily snapshots, sessions, and invitations.
- **Server-sent events:** authenticated, data-free invalidations; clients refetch records through authorized APIs. The party view also refreshes while visible to account for active timers.
- **Authentication:** salted scrypt password hashes, random session tokens hashed in the database, expiring HTTP-only same-site cookies, and per-process rate limits on sign-in and account creation.
- **Authorization:** ownership/current membership checks in the server data layer for every task, party, history, and management operation. The database is never accessible directly from the browser. Party ownership does not grant permission to edit another user's tasks.
- **Invitations:** random hashed tokens, seven-day expiry, revocation, and explicit acceptance.
- **HTTP hardening:** same-origin JSON writes, security headers, a restricted content-security policy, and no-store caching for authenticated APIs.

Main code: `src/server/store.ts` (domain/permissions), `src/server/db.ts` (lazy database initialization), `src/server/time.ts` (timezone arithmetic), `src/app/api/` (HTTP/SSE), `src/components/` (interface), and `src/shared/types.ts` (shared contracts).

Email is an account identifier. Email delivery, email verification, and password-reset mail are not configured; the UI does not pretend to send them. Keep your password securely. This app does not include public discovery, chat, AI coaching, or push notifications.

## Production

```sh
npm run build
npm start
```

`npm start` runs the standalone server produced by the build. Set `PORT` or `BIND_HOST` to change the listener.

Run **one persistent Node server process** with writable, persistent disk. SQLite and the process-local SSE event bus are not designed for multiple app replicas or ephemeral/serverless filesystems. Build workers do not open or modify the database.

For a container deployment:

```sh
docker compose up -d --build
```

A Render Blueprint is included in `render.yaml`. See [DEPLOYMENT.md](DEPLOYMENT.md) for Render, reverse-proxy, HTTPS, persistent-volume, backup, and upgrade details.

- Set `DATABASE_PATH` to a location on a persistent volume if `.data/` is not persistent on your host.
- Serve over HTTPS and set `COOKIE_SECURE=true` on a public deployment.
- If using a reverse proxy, preserve the original `Host` header and allow long-lived `/api/events` responses without proxy buffering. POSTs reject mismatched origins.
- Do not enable caching for authenticated APIs. Keep the database inaccessible from public static directories.
- Health check: `GET /api/health` returns `{"ok":true}` when the database is reachable.
- Back up with `npm run backup -- /path/to/backup.sqlite`, SQLite-aware tooling, or stop the server before filesystem backups; a live database may have uncheckpointed WAL data.
- Do not run development and production servers against the same database during a release migration.

Auth and invite endpoints are rate limited in memory. Limit state resets on restart, which is consistent with the single-process requirement.

## Verification

```sh
npm run typecheck
npm test
npm run build
```

Or run the first two together with `npm run check`.

The [security review](SECURITY.md) records the controls tested, the current findings, and the residual launch risks.

For a disposable local server, the security smoke test checks headers, cookies, CSRF, body limits, authorization boundaries, invite security, SQL/XSS-shaped input, SSE audience isolation, and rate limiting. It creates test accounts and must never be run against a real database:

```sh
SECURITY_BASE_URL=http://127.0.0.1:3105 \
DATABASE_PATH=.data/security-test.sqlite \
npm run security:smoke
```

On PowerShell, set `$env:SECURITY_BASE_URL` and `$env:DATABASE_PATH` first.

After deploying, verify the live instance with `npm run check:live` (creates test accounts and data):

```sh
LIVE_BASE_URL=https://your-app.onrender.com npm run check:live
```

The isolated regression suite exercises authentication/session expiry, auth rate limiting, task ownership, concurrent increments across processes, corrections, stale-edit conflicts, historical snapshots, schedules, archive boundaries, streaks, persistent timers, 23/25-hour DST days, timezone changes, invitation expiry/revocation, membership removal, shared-history privacy, and ownership transfer.

Real-browser verification also exercises account creation, all tracking types, invite acceptance in a separate browser context, live progress updates, removal from an already-open party, timer reload persistence, pending task edits, input-preserving server errors, keyboard-trapped dialogs, offline/reconnect behavior, navigation history, and narrow-screen layouts. Test accounts and databases are separate from the default application database.
