# Security review

Tested: **2026-11-18** · Next.js 16.4.6 · Node.js 22.13.1 · Docker 29.4.0 · production standalone build

## Scope

The review covered the web application, API, authentication/session handling, party authorization, invitations, SQLite persistence, server-sent events, the production headers, the client rendering path, dependencies, and the deployment files. It was performed against a disposable local database; no real user data was used.

## Method

- Static review of the server data layer, route handlers, session/auth code, SSE bus, and client rendering sinks.
- Dependency audit with `npm audit`.
- Secret, source-map, and build-artifact checks.
- Automated HTTP security smoke test (`npm run security:smoke`).
- Browser checks for stored/reflected/DOM XSS, cookie exposure, and CSP behavior.
- Docker image build and run with a root-owned persistent volume, including health checks and restart persistence.
- Lighthouse accessibility, best-practices, and SEO audits on the auth screen and signed-in app.

## Result

**123 of 124 automated security checks passed. 1 warning, 0 failures.**

- `npm audit --omit=dev`: 0 known production vulnerabilities. The full tree reports one unpatchable dev-tooling advisory (picomatch ReDoS, no patched release exists); see finding 12.
- Docker image builds and runs successfully. The app process runs as UID 1000 (`node`), not root; a root-owned test volume was repaired by the entrypoint; `/api/health` reached healthy; SQLite data and a session survived a container restart.
- No secrets, database files, `.env` files, or client source maps in the repository or build output.
- Stored and reflected XSS payloads were rendered as inert text. `window.__xss*` probes never fired, and `document.cookie` could not read the session cookie.
- Lighthouse: **100 Accessibility, 100 Best Practices, 100 SEO** on both the auth screen and the signed-in app.

## Controls verified

- Password hashes use salted scrypt; plaintext passwords are never stored.
- Session and invitation tokens are random, high-entropy, and stored only as hashes.
- Session cookies are `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` when `COOKIE_SECURE=true`.
- Session fixation attempts are rejected; logout invalidates the server-side session.
- Same-origin JSON enforcement, SameSite cookies, and origin checks block CSRF-shaped writes.
- CORS is disabled; preflight and unsupported HTTP methods are rejected.
- IDOR checks cover tasks, progress, parties, member history, invitations, removal, transfer, and leaving.
- Party owners cannot edit other members' tasks; members cannot manage the party.
- Private tasks/history/activity are excluded from party data.
- Invite previews expose no token/hash; revoked and random tokens are rejected; joins require authentication.
- SQL-shaped input is stored as data; query parameters are validated; no SQL injection path was found.
- Prototype-pollution-shaped and mass-assignment-shaped bodies are ignored by the schemas.
- Path traversal and static-file probes (`/.env`, database paths, source paths) return 404.
- Request bodies are capped at 32 KiB, including chunked bodies without `Content-Length`.
- Error responses do not expose stack traces or SQL errors.
- SSE requires authentication, carries no task data, notifies only the correct audience, and is capped at 10 live connections per account.
- Auth and invitation endpoints are rate limited; authenticated writes are limited to 300/minute per account.
- Resource caps bound 20 owned parties, 2,000 task records (200 active), and 50 active invites per party.
- Security headers include CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, COOP, CORP, and no `X-Powered-By`.

## Findings and residual risks

### 1. Registration reveals whether an email exists — Low

Registering an existing email returns `409`. This is an account-enumeration signal. It is difficult to remove without email verification or always-successful registration.

**Status:** accepted for the initial release; rate limits reduce bulk enumeration.

### 2. Per-IP limits trust proxy headers — Low

`X-Real-IP`/`X-Forwarded-For` are used for per-IP buckets. A directly exposed Node port lets a client rotate those headers and avoid the per-IP limit. App-wide and per-account caps remain in force.

**Mitigation:** keep the Node port behind Render or another trusted proxy that overwrites these headers; never expose port 3000 publicly. This is documented in `DEPLOYMENT.md`.

### 3. CSP allows inline scripts — Low

`script-src` includes `'unsafe-inline'` for Next.js. If an HTML-injection sink were introduced later, CSP would not stop an inline XSS. No such sink was found: React escapes all tested user content and there is no `dangerouslySetInnerHTML`, `eval`, or `new Function` in application code.

**Recommendation:** move to a nonce-based CSP before adding rich HTML, embeds, or third-party widgets.

### 4. Password KDF work factor — Low

scrypt uses `N=16384, r=8, p=1`. This is adequate but below higher-memory recommendations. Existing hashes are stored as `salt:hash` without parameters, so increasing the factor needs a versioned hash-and-rehash-on-login migration.

### 5. Session lifetime and scope — Low

Sessions last 30 days with no idle timeout, no “sign out everywhere” action, and no `__Host-` cookie prefix. This is acceptable for a small tracker; consider shortening idle sessions and adding a global logout for shared devices.

### 6. Account lifecycle and abuse controls — Low / operational

Registration is open, with no email verification, password reset, account deletion, or data export. Rate limits and resource caps reduce abuse, but a public launch should add email verification, password reset, account deletion/export, and legal pages.

### 7. Data at rest and backups — Low / deployment-dependent

On a paid Render instance, Render encrypts persistent disks and their automatic snapshots at rest. The application itself does not encrypt the SQLite file, and off-host backup copies are your responsibility. Protect those copies, and do not rely on a Render disk snapshot to recover a SQLite database (Render recommends against restoring a disk snapshot for custom databases). Use the SQLite-aware backup and test restores.

On the **free** Render instance there is no disk, no Shell, and no backup path: the filesystem is wiped on redeploy, restart, or spin-down. The free deployment is a demo only; do not store real user data there.

### 8. Multi-use invitation links — Informational

An invitation link can add multiple people until it expires or is revoked. This is intentional for small parties; use revocation or a single-use invite design if needed.

### 9. Historical party visibility on rejoin — Informational

Leaving revokes current access, but previously shared days remain associated with the party and can become visible again if the same person rejoins. This follows the “preserve historical sharing” design; sever past shares explicitly if rejoin should not restore them.

### 10. In-memory rate limiting — Informational

Rate-limit state resets on restart and is per process. This matches the single-process architecture. Multiple replicas would require a shared limiter and are not supported.

### 11. Availability and DDoS — Informational

The app has request/body/SSE/resource caps, but public DDoS, disk exhaustion, and sustained authenticated abuse should be handled at the host/WAF/monitoring layer. Render's disk is 1 GB in the Blueprint; monitor usage.

### 12. Supply chain and build — Informational

The Docker base image uses a mutable tag, and `next/font` fetches Google Fonts at build time (runtime fonts are self-hosted). Pin the base image digest and consider vendoring fonts for reproducible builds. Run `npm audit` and an image scanner in CI.

Next.js was upgraded to 16.4.6 to clear GHSA-mfr8-8qww-v76h and GHSA-vc7v-qv4w-wrv8 (cache disclosure across root params via `'use cache'`/`unstable_cache()`). This app uses neither feature and serves `no-store` on all authenticated responses, so those advisories did not expose data here.

`npm audit --omit=dev` reports 0 production vulnerabilities. The full tree flags CVE-2026-112366 (picomatch ReDoS, GHSA-fc5q-39xc-vjpf) in the lint toolchain (`eslint-config-next` → `fast-glob` → `micromatch` → `picomatch`). No patched picomatch release exists (4.0.7 is the latest and is affected). The vulnerable path requires passing attacker-controlled glob patterns to a matcher; no user input reaches glob matching in this app, and the copy is dev-tooling only. Re-run `npm audit` when a patched release ships.

### 13. Not tested here — Informational

Safari/Firefox and external DDoS tooling were not exercised. TLS termination and Render's proxy behavior were verified against a live free-tier deployment on 2026-11-18: HTTP redirected to HTTPS, cookies carried `Secure`, SSE streamed through Render's proxy, and all 38 live checks (`npm run check:live`) passed.

## Reproduction

Start a disposable local server with a temporary database, then run:

```sh
SECURITY_BASE_URL=http://127.0.0.1:3105 \
DATABASE_PATH=.data/security-test.sqlite \
npm run security:smoke
```

The script creates test accounts and data. It refuses non-local targets unless `SECURITY_TEST_ALLOW_REMOTE=1` is set; never point it at a real database.
