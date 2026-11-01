import http from "node:http";
import https from "node:https";
import { DatabaseSync } from "node:sqlite";

const base = process.env.SECURITY_BASE_URL || "http://127.0.0.1:3105";
const databasePath = process.env.DATABASE_PATH;
const allowRemote = process.env.SECURITY_TEST_ALLOW_REMOTE === "1";

if (
  !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base) &&
  !allowRemote
) {
  console.error(
    "Refusing to run write-heavy security tests against a non-local target.",
  );
  console.error(
    "Set SECURITY_TEST_ALLOW_REMOTE=1 only for a disposable staging instance.",
  );
  process.exit(1);
}

const results = [];
function record(name, ok, detail = "", warning = false) {
  results.push({ name, ok, detail, warning });
  const mark = ok ? "PASS" : warning ? "WARN" : "FAIL";
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ""}`);
}
function check(name, ok, detail = "") {
  record(name, ok, detail, false);
}
function warn(name, ok, detail = "") {
  record(name, ok, detail, true);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function client() {
  let cookie = "";
  return {
    get cookie() {
      return cookie;
    },
    setCookie(value) {
      cookie = value;
    },
    async req(
      path,
      {
        method = "GET",
        body,
        rawText,
        headers = {},
        useCookie = true,
        origin = base,
      } = {},
    ) {
      const requestHeaders = { ...headers };
      if (body !== undefined || rawText !== undefined) {
        if (!requestHeaders["Content-Type"])
          requestHeaders["Content-Type"] = "application/json";
        if (origin) requestHeaders.Origin = origin;
      }
      if (useCookie && cookie) requestHeaders.Cookie = cookie;
      const response = await fetch(base + path, {
        method,
        headers: requestHeaders,
        body:
          rawText !== undefined
            ? rawText
            : body === undefined
              ? undefined
              : JSON.stringify(body),
        redirect: "manual",
      });
      for (const value of response.headers.getSetCookie()) {
        const pair = value.split(";")[0];
        if (pair.startsWith("one_percent_session=")) cookie = pair;
      }
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return {
        status: response.status,
        headers: response.headers,
        data,
        text,
        setCookie: response.headers.getSetCookie(),
      };
    },
  };
}

function chunkedPost(path, text, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(base + path);
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(
      {
        hostname: url.hostname,
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: base,
          ...headers,
        },
      },
      (response) => {
        let data = "";
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () =>
          resolve({ status: response.statusCode, data }),
        );
      },
    );
    request.on("error", reject);
    const midpoint = Math.floor(text.length / 2);
    request.write(text.slice(0, midpoint));
    request.write(text.slice(midpoint));
    request.end();
  });
}

const run = `sec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const password = "correct horse battery staple";

function email(label) {
  return `${label}-${run}@example.com`;
}

// ---------------------------------------------------------------------------
// Transport and headers
// ---------------------------------------------------------------------------
const anonymous = client();
const home = await anonymous.req("/", { useCookie: false });
check("home page responds", home.status === 200);
const csp = home.headers.get("content-security-policy") || "";
check("CSP present", csp.includes("default-src 'self'"));
check("CSP blocks framing", csp.includes("frame-ancestors 'none'"));
check("CSP blocks objects", csp.includes("object-src 'none'"));
check(
  "HSTS present",
  (home.headers.get("strict-transport-security") || "").includes("max-age="),
);
check("X-Frame-Options DENY", home.headers.get("x-frame-options") === "DENY");
check(
  "X-Content-Type-Options nosniff",
  home.headers.get("x-content-type-options") === "nosniff",
);
check(
  "Referrer-Policy same-origin",
  home.headers.get("referrer-policy") === "same-origin",
);
check(
  "Permissions-Policy present",
  (home.headers.get("permissions-policy") || "").includes("camera=()"),
);
check(
  "COOP present",
  home.headers.get("cross-origin-opener-policy") === "same-origin",
);
check(
  "CORP present",
  home.headers.get("cross-origin-resource-policy") === "same-origin",
);
check("X-Powered-By hidden", !home.headers.has("x-powered-by"));
check(
  "CORS is not enabled",
  !home.headers.has("access-control-allow-origin"),
);

const health = await anonymous.req("/api/health", { useCookie: false });
check("health endpoint", health.status === 200 && health.data.ok === true);
check(
  "health is not cached",
  health.headers.get("cache-control") === "no-store",
);

const preflight = await anonymous.req("/api/dashboard", {
  method: "OPTIONS",
  useCookie: false,
  headers: {
    Origin: "https://evil.example",
    "Access-Control-Request-Method": "POST",
  },
});
check(
  "no CORS preflight allowance",
  !preflight.headers.has("access-control-allow-origin"),
);
check(
  "unsupported methods rejected",
  [405, 204, 200].includes(preflight.status) && preflight.status !== 200,
);

for (const method of ["PUT", "PATCH", "DELETE"]) {
  const response = await anonymous.req("/api/dashboard", {
    method,
    useCookie: false,
  });
  check(`${method} rejected`, response.status === 405, String(response.status));
}

// ---------------------------------------------------------------------------
// CSRF, content type, and body limits
// ---------------------------------------------------------------------------
for (const [index, [name, origin]] of [
  ["cross-origin POST rejected", "https://evil.example"],
  ["origin-less POST rejected", null],
].entries()) {
  const response = await anonymous.req("/api/auth/register", {
    method: "POST",
    useCookie: false,
    origin: origin,
    body: {
      name: "CSRF Test",
      email: email(`csrf-${index}`),
      password,
      timezone: "UTC",
    },
    headers: {},
  });
  check(name, response.status === 403, String(response.status));
}

const wrongType = await anonymous.req("/api/auth/login", {
  method: "POST",
  useCookie: false,
  rawText: JSON.stringify({ email: email("type"), password }),
  headers: { "Content-Type": "text/plain" },
});
check(
  "non-JSON content type rejected",
  wrongType.status === 415,
  String(wrongType.status),
);

const malformed = await anonymous.req("/api/auth/login", {
  method: "POST",
  useCookie: false,
  rawText: "{",
});
check("malformed JSON rejected", malformed.status === 400);

const arrayBody = await anonymous.req("/api/auth/login", {
  method: "POST",
  useCookie: false,
  rawText: "[]",
});
check("array body rejected", arrayBody.status === 400);

const largeBody = JSON.stringify({ email: email("large"), blob: "A".repeat(40000) });
const large = await anonymous.req("/api/auth/login", {
  method: "POST",
  useCookie: false,
  rawText: largeBody,
});
check("oversized body rejected", large.status === 413, String(large.status));

const chunked = await chunkedPost("/api/auth/login", largeBody);
check(
  "oversized chunked body rejected",
  chunked.status === 413,
  String(chunked.status),
);

// ---------------------------------------------------------------------------
// Accounts, cookie flags, storage
// ---------------------------------------------------------------------------
const a = client();
const registeredA = await a.req("/api/auth/register", {
  method: "POST",
  useCookie: false,
  body: {
    name: "Security A",
    email: email("a"),
    password,
    timezone: "UTC",
    id: "attacker-supplied-id",
    role: "owner",
  },
});
check("account A created", registeredA.status === 200 && !!a.cookie);
if (!a.cookie || !registeredA.data.user) {
  console.error("Cannot continue without account A");
  process.exit(1);
}
check(
  "mass-assigned id ignored",
  registeredA.data.user.id !== "attacker-supplied-id",
);
const cookieA = registeredA.setCookie.join("; ");
check("session cookie is HttpOnly", /HttpOnly/i.test(cookieA));
check("session cookie is SameSite=Lax", /SameSite=Lax/i.test(cookieA));
check("session cookie has Path=/", /Path=\//i.test(cookieA));
if (base.startsWith("https://")) {
  check("session cookie is Secure on HTTPS", /Secure/i.test(cookieA));
} else {
  warn(
    "session cookie Secure flag",
    !/Secure/i.test(cookieA),
    "not set on plain HTTP; set COOKIE_SECURE=true in production",
  );
}

const session = await a.req("/api/session");
check("session resolves account A", session.data.user?.email === email("a"));

const fixation = client();
fixation.setCookie("one_percent_session=attacker-chosen-token");
const fixedSession = await fixation.req("/api/session");
check("chosen session token is rejected", fixedSession.data.user === null);
const fixedDashboard = await fixation.req("/api/dashboard");
check("chosen session cannot read data", fixedDashboard.status === 401);

// DB-level storage checks
let db;
if (databasePath) {
  try {
    db = new DatabaseSync(databasePath, { readOnly: true });
  } catch {
    try {
      db = new DatabaseSync(databasePath);
    } catch {
      warn("database checks", false, "could not open DATABASE_PATH");
    }
  }
}
if (db) {
  const userRow = db
    .prepare("SELECT id,password FROM users WHERE email=?")
    .get(email("a"));
  check("account stored", !!userRow);
  check(
    "password is not stored in plaintext",
    !!userRow && !userRow.password.includes(password),
  );
  check(
    "password uses a salted scrypt-style hash",
    !!userRow && /^[0-9a-f]{32}:[0-9a-f]{128}$/.test(userRow.password),
  );
  const sessionRow = db
    .prepare(
      "SELECT hash FROM sessions WHERE user_id=? ORDER BY expires_at DESC LIMIT 1",
    )
    .get(userRow.id);
  const rawToken = (a.cookie.split("=")[1] || "").trim();
  check(
    "session token is hashed at rest",
    !!sessionRow && /^[0-9a-f]{64}$/.test(sessionRow.hash),
  );
  check(
    "stored session hash differs from the cookie",
    !!sessionRow && sessionRow.hash !== rawToken,
  );
} else {
  warn(
    "database-level storage checks",
    false,
    "DATABASE_PATH not set or the database could not be opened; skipped",
  );
}

// ---------------------------------------------------------------------------
// Functional accounts and authorization boundaries
// ---------------------------------------------------------------------------
const b = client();
const registeredB = await b.req("/api/auth/register", {
  method: "POST",
  useCookie: false,
  body: {
    name: "Security B",
    email: email("b"),
    password,
    timezone: "UTC",
  },
});
check("account B created", registeredB.status === 200 && !!b.cookie);
const c = client();
const registeredC = await c.req("/api/auth/register", {
  method: "POST",
  useCookie: false,
  body: {
    name: "Security C",
    email: email("c"),
    password,
    timezone: "UTC",
  },
});
check("account C created", registeredC.status === 200 && !!c.cookie);
if (!b.cookie || !c.cookie || !registeredB.data.user || !registeredC.data.user) {
  console.error("Cannot continue without accounts B and C");
  process.exit(1);
}

const dashboardA = await a.req("/api/dashboard");
const dateA = dashboardA.data.date;
const taskTitle = `Private ${run} Robert'); DROP TABLE users;--`;
const privateTask = await a.req("/api/tasks/save", {
  method: "POST",
  body: {
    title: taskTitle,
    description: '<script>window.__xss=1</script>',
    type: "count",
    target: 10,
    unit: "pages",
    schedule: { kind: "daily", days: [] },
    startDate: dateA,
    endDate: null,
    partyId: null,
    user_id: registeredB.data.user.id,
    ownerId: registeredB.data.user.id,
  },
});
check("SQL-looking task title is stored as data", privateTask.status === 200);
let dashboard = await a.req("/api/dashboard");
const privateTaskRow = dashboard.data.tasks.find((item) => item.title === taskTitle);
check("SQL-looking title is rendered as data", !!privateTaskRow);
check(
  "mass-assigned task owner ignored",
  dashboard.data.user.id === registeredA.data.user.id,
);
check(
  "database still functions after SQL-looking input",
  (await a.req("/api/session")).data.user?.email === email("a"),
);

if (!privateTaskRow) {
  console.error("Cannot continue without a private task");
  process.exit(1);
}

await a.req("/api/progress/log", {
  method: "POST",
  body: {
    taskId: privateTaskRow.id,
    date: dateA,
    operation: "set",
    value: 10,
  },
});
const bPrivateTask = await b.req("/api/progress/log", {
  method: "POST",
  body: {
    taskId: privateTaskRow.id,
    date: dateA,
    operation: "set",
    value: 10,
  },
});
check("B cannot log A's task", bPrivateTask.status === 404);
const bArchive = await b.req("/api/tasks/archive", {
  method: "POST",
  body: { id: privateTaskRow.id },
});
check("B cannot archive A's task", bArchive.status === 404);
const bProgress = await b.req(
  `/api/progress?range=week&anchor=${dateA}&taskId=${encodeURIComponent(privateTaskRow.id)}`,
);
check("B cannot read A's task history", bProgress.status === 404);
const bStaleEdit = await b.req("/api/tasks/save", {
  method: "POST",
  body: {
    ...privateTaskRow,
    title: "Hijacked",
  },
});
check("B cannot edit A's task", bStaleEdit.status === 404);

// ---------------------------------------------------------------------------
// Parties, invites, private/shared data
// ---------------------------------------------------------------------------
const partyResponse = await a.req("/api/parties", {
  method: "POST",
  body: {
    name: `Sec party ${run}`,
    description: "security test",
    ownerId: registeredB.data.user.id,
    owner_id: registeredB.data.user.id,
  },
});
check("party created", partyResponse.status === 200 && !!partyResponse.data.party?.id);
const partyId = partyResponse.data.party?.id;
if (!partyId) {
  console.error("Cannot continue without a party");
  process.exit(1);
}
check("mass-assigned party owner ignored", partyResponse.data.party?.ownerId !== registeredB.data.user.id);
const outsiderParty = await c.req(`/api/parties/${partyId}`);
check("outsider cannot read party", outsiderParty.status === 404);
const outsiderHistory = await c.req(
  `/api/parties/${partyId}/members/${registeredA.data.user.id}/history?range=week`,
);
check("outsider cannot read party history", outsiderHistory.status === 404);
const outsiderJoin = await c.req(`/api/parties/${partyId}/invites`, {
  method: "POST",
  body: {},
});
check("outsider cannot create invites", outsiderJoin.status === 404 || outsiderJoin.status === 403);

const invite = await a.req(`/api/parties/${partyId}/invites`, {
  method: "POST",
  body: {},
});
check("owner can create invite", invite.status === 200 && !!invite.data.token);
check(
  "invite token has sufficient entropy",
  typeof invite.data.token === "string" && invite.data.token.length >= 32,
);
const inviteId = invite.data.id;
const inviteToken = invite.data.token;

const partyDetail = await a.req(`/api/parties/${partyId}`);
const partyJson = JSON.stringify(partyDetail.data);
check(
  "invite token is not exposed in party detail",
  !partyJson.includes(inviteToken),
);
check(
  "invite list has no hashes",
  Array.isArray(partyDetail.data.invites) &&
    partyDetail.data.invites.every((item) => !("hash" in item)),
);
const preview = await anonymous.req(
  `/api/invites/${encodeURIComponent(inviteToken)}`,
  { useCookie: false },
);
check("invite preview is public", preview.status === 200);
check(
  "invite preview exposes no token or hash",
  !JSON.stringify(preview.data).includes(inviteToken),
);
const unauthJoin = await anonymous.req(
  `/api/invites/${encodeURIComponent(inviteToken)}/join`,
  { method: "POST", body: {}, useCookie: false },
);
check("invite join requires authentication", unauthJoin.status === 401);
const randomInvite = await anonymous.req(
  `/api/invites/${"x".repeat(43)}`,
  { useCookie: false },
);
check("random invite token is rejected", randomInvite.status === 404);

const joinedB = await b.req(
  `/api/invites/${encodeURIComponent(inviteToken)}/join`,
  { method: "POST", body: {} },
);
check("member B joins party", joinedB.status === 200);
const bParty = await b.req(`/api/parties/${partyId}`);
check("member B can read party", bParty.status === 200);
const bInviteCreate = await b.req(`/api/parties/${partyId}/invites`, {
  method: "POST",
  body: {},
});
check("member cannot create invites", bInviteCreate.status === 403);
const bPartyUpdate = await b.req(`/api/parties/${partyId}/settings`, {
  method: "POST",
  body: { name: "Hijacked", description: "" },
});
check("member cannot edit party", bPartyUpdate.status === 403);
const bRemoveOwner = await b.req(`/api/parties/${partyId}/members`, {
  method: "POST",
  body: { action: "remove", memberId: registeredA.data.user.id },
});
check("member cannot remove owner", bRemoveOwner.status === 403);

// Private data must not appear in the party.
const bPartyAfterJoin = await b.req(`/api/parties/${partyId}`);
const bPartyJson = JSON.stringify(bPartyAfterJoin.data);
check(
  "private task is absent from party data",
  !bPartyJson.includes(taskTitle),
);
check(
  "private task is absent from party activity",
  !bPartyJson.includes("window.__xss"),
);

// Shared task by A is visible to B, not C.
const sharedTitle = `Shared ${run}`;
const sharedTask = await a.req("/api/tasks/save", {
  method: "POST",
  body: {
    title: sharedTitle,
    description: "",
    type: "count",
    target: 10,
    unit: "pages",
    schedule: { kind: "daily", days: [] },
    startDate: dateA,
    endDate: null,
    partyId,
  },
});
check("A creates shared task", sharedTask.status === 200);
dashboard = await a.req("/api/dashboard");
const sharedRow = dashboard.data.tasks.find((item) => item.title === sharedTitle);
if (sharedRow) {
  await a.req("/api/progress/log", {
    method: "POST",
    body: {
      taskId: sharedRow.id,
      date: dateA,
      operation: "add",
      value: 4,
    },
  });
}
const bPartyShared = await b.req(`/api/parties/${partyId}`);
check(
  "shared task is visible to party member",
  JSON.stringify(bPartyShared.data).includes(sharedTitle),
);
const cPartyShared = await c.req(`/api/parties/${partyId}`);
check("outsider still cannot read shared party", cPartyShared.status === 404);

// B cannot edit A's shared task, even as a party member.
const bEditShared = await b.req("/api/tasks/save", {
  method: "POST",
  body: {
    ...sharedRow,
    title: "Member edit attempt",
  },
});
check("member cannot edit another member's task", bEditShared.status === 404);

// Revoke and re-check the invite.
const revoke = await a.req(
  `/api/parties/${partyId}/invites/${inviteId}/revoke`,
  { method: "POST", body: {} },
);
check("owner can revoke invite", revoke.status === 200);
const revokedPreview = await anonymous.req(
  `/api/invites/${encodeURIComponent(inviteToken)}`,
  { useCookie: false },
);
check("revoked invite is rejected", revokedPreview.status === 404);

// Invite hash storage.
if (db) {
  const inviteRow = db
    .prepare("SELECT hash FROM invites WHERE id=?")
    .get(inviteId);
  check(
    "invite token is hashed at rest",
    !!inviteRow && /^[0-9a-f]{64}$/.test(inviteRow.hash),
  );
  check(
    "stored invite hash differs from the token",
    !!inviteRow && inviteRow.hash !== inviteToken,
  );
}

// Transfer ownership and verify role change.
const transfer = await a.req(`/api/parties/${partyId}/members`, {
  method: "POST",
  body: { action: "transfer", memberId: registeredB.data.user.id },
});
check("owner can transfer ownership", transfer.status === 200);
const oldOwnerInvite = await a.req(`/api/parties/${partyId}/invites`, {
  method: "POST",
  body: {},
});
check("old owner cannot create invites", oldOwnerInvite.status === 403);
const newOwnerInvite = await b.req(`/api/parties/${partyId}/invites`, {
  method: "POST",
  body: {},
});
check("new owner can create invites", newOwnerInvite.status === 200);

// Ownership transfer leaves A as a member and B as owner.
const ownerLeave = await b.req(`/api/parties/${partyId}/members`, {
  method: "POST",
  body: { action: "leave" },
});
check("owner must transfer before leaving", ownerLeave.status === 409);
const memberLeave = await a.req(`/api/parties/${partyId}/members`, {
  method: "POST",
  body: { action: "leave" },
});
check("member can leave party", memberLeave.status === 200);
const aAfterLeave = await a.req(`/api/parties/${partyId}`);
check("left member loses party access", aAfterLeave.status === 404);
const aDashboardAfterLeave = await a.req("/api/dashboard");
check("personal dashboard survives leaving", aDashboardAfterLeave.status === 200);
const lastOwnerLeave = await b.req(`/api/parties/${partyId}/members`, {
  method: "POST",
  body: { action: "leave" },
});
check("last owner can leave and delete party", lastOwnerLeave.status === 200);
const bAfterPartyDeleted = await b.req(`/api/parties/${partyId}`);
check("deleted party is gone", bAfterPartyDeleted.status === 404);

// ---------------------------------------------------------------------------
// Query validation, mass assignment, and path handling
// ---------------------------------------------------------------------------
const badRange = await a.req("/api/progress?range=week'%20OR%20'1'='1");
check("invalid range rejected", badRange.status === 400);
const badAnchor = await a.req(
  `/api/progress?range=week&anchor=${encodeURIComponent("2026-01-01' OR '1'='1")}`,
);
check("invalid anchor rejected", badAnchor.status === 400);
const badTaskId = await a.req(
  `/api/progress?range=week&taskId=${encodeURIComponent("x' OR '1'='1")}`,
);
check(
  "invalid task id is rejected without SQL execution",
  [400, 404].includes(badTaskId.status),
);
const badTask = await a.req("/api/tasks/save", {
  method: "POST",
  body: {
    title: "Bad task",
    description: "",
    type: "count",
    target: -1,
    unit: "pages",
    schedule: { kind: "weekdays", days: [9] },
    startDate: dateA,
    endDate: null,
    partyId: null,
  },
});
check("invalid task input rejected", badTask.status === 400);
const badTimezone = await a.req("/api/profile", {
  method: "POST",
  body: { name: "Security A", timezone: "../../etc/passwd" },
});
check("invalid timezone rejected", badTimezone.status === 400);
const proto = await a.req("/api/tasks/save", {
  method: "POST",
  body: {
    title: `Proto ${run}`,
    description: "",
    type: "binary",
    target: 1,
    unit: "",
    schedule: { kind: "daily", days: [] },
    startDate: dateA,
    endDate: null,
    partyId: null,
    ["__proto__"]: { polluted: true },
    constructor: { prototype: { polluted: true } },
  },
});
check("prototype-pollution-shaped input is accepted safely", proto.status === 200);

for (const path of [
  "/.env",
  "/.env.local",
  "/data/one-percent.sqlite",
  "/.data/one-percent.sqlite",
  "/api/../.env",
  "/_next/static/../server.js",
]) {
  const response = await anonymous.req(path, { useCookie: false });
  check(`static path not exposed: ${path}`, response.status === 404);
}

// ---------------------------------------------------------------------------
// SSE authorization and audience isolation
// ---------------------------------------------------------------------------
const unauthSse = await anonymous.req("/api/events", { useCookie: false });
check("SSE requires authentication", unauthSse.status === 401);

// Set up a fresh party for the cross-user SSE test. B is a member; C is not.
const ssePartyResponse = await a.req("/api/parties", {
  method: "POST",
  body: { name: `SSE party ${run}`, description: "" },
});
const ssePartyId = ssePartyResponse.data.party?.id;
const sseInvite = await a.req(`/api/parties/${ssePartyId}/invites`, {
  method: "POST",
  body: {},
});
const sseJoin = await b.req(
  `/api/invites/${encodeURIComponent(sseInvite.data.token)}/join`,
  { method: "POST", body: {} },
);
check("SSE test party is ready", !!ssePartyId && sseJoin.status === 200);
if (!ssePartyId) {
  console.error("Cannot continue without an SSE test party");
  process.exit(1);
}

const sseController = new AbortController();
const sse = await fetch(base + "/api/events", {
  headers: { Cookie: a.cookie },
  signal: sseController.signal,
});
check("authenticated SSE opens", sse.status === 200);
const sseReader = sse.body.getReader();
const sseDecoder = new TextDecoder();
let sseBuffer = "";
const ssePump = (async () => {
  try {
    for (;;) {
      const { done, value } = await sseReader.read();
      if (done) break;
      sseBuffer += sseDecoder.decode(value, { stream: true });
    }
  } catch {
    /* aborted */
  }
})();
async function waitFor(predicate, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await sleep(50);
  }
  return predicate();
}
check(
  "SSE sends a data-free connected event",
  await waitFor(() => sseBuffer.includes(": connected"), 2000),
);
check(
  "SSE is data-free",
  !sseBuffer.includes(taskTitle) && !sseBuffer.includes(sharedTitle),
);

// C is not in A's party: C's private mutation must not notify A.
const privateMarker = sseBuffer.length;
const cPrivate = await c.req("/api/tasks/save", {
  method: "POST",
  body: {
    title: `C private ${run}`,
    description: "",
    type: "binary",
    target: 1,
    unit: "",
    schedule: { kind: "daily", days: [] },
    startDate: dateA,
    endDate: null,
    partyId: null,
  },
});
check("C creates a private task", cPrivate.status === 200);
await sleep(900);
check(
  "private mutation does not notify an unrelated user",
  !sseBuffer.slice(privateMarker).includes("event: refresh"),
);
const sharedMarker = sseBuffer.length;
const bShared = await b.req("/api/tasks/save", {
  method: "POST",
  body: {
    title: `B shared ${run}`,
    description: "",
    type: "binary",
    target: 1,
    unit: "",
    schedule: { kind: "daily", days: [] },
    startDate: dateA,
    endDate: null,
    partyId: ssePartyId,
  },
});
check("party member creates a shared task", bShared.status === 200);
check(
  "shared mutation notifies the party audience",
  await waitFor(
    () => sseBuffer.slice(sharedMarker).includes("event: refresh"),
    2000,
  ),
);
sseController.abort();
await ssePump;

// A single account cannot hold an unbounded number of live SSE streams.
const sseControllers = [];
let sseCapOpened = 0;
for (let index = 0; index < 10; index++) {
  const controller = new AbortController();
  const response = await fetch(base + "/api/events", {
    headers: { Cookie: a.cookie },
    signal: controller.signal,
  });
  if (response.status !== 200) break;
  sseCapOpened++;
  sseControllers.push(controller);
}
const overflowSse = await fetch(base + "/api/events", {
  headers: { Cookie: a.cookie },
});
check(
  "SSE connections are capped per account",
  sseCapOpened === 10 && overflowSse.status === 429,
  `${sseCapOpened} opened, overflow ${overflowSse.status}`,
);
for (const controller of sseControllers) controller.abort();
await sleep(150);

// ---------------------------------------------------------------------------
// Cache, errors, and disclosure
// ---------------------------------------------------------------------------
const dashboardCache = await a.req("/api/dashboard");
check(
  "authenticated API is not cached",
  dashboardCache.headers.get("cache-control") === "no-store",
);
const unknown = await a.req("/api/does-not-exist");
check("unknown API returns JSON 404", unknown.status === 404 && !!unknown.data.error);
const notFoundPage = await anonymous.req("/does-not-exist", { useCookie: false });
check("unknown page returns 404", notFoundPage.status === 404);
check(
  "error responses do not leak stack traces",
  !JSON.stringify(unknown.data).includes("at ") &&
    !JSON.stringify(unknown.data).includes("SQLITE"),
);
const homeHtml = (await anonymous.req("/", { useCookie: false })).text;
const scriptMatch = /src="([^"]+\.js)"/.exec(homeHtml);
if (scriptMatch) {
  const map = await anonymous.req(scriptMatch[1] + ".map", { useCookie: false });
  check("client source maps are not published", map.status === 404);
} else {
  warn("client source map check", true, "no script URL found to test");
}

// ---------------------------------------------------------------------------
// Rate limiting and account enumeration
// ---------------------------------------------------------------------------
const duplicate = await anonymous.req("/api/auth/register", {
  method: "POST",
  useCookie: false,
  body: {
    name: "Duplicate",
    email: email("a"),
    password,
    timezone: "UTC",
  },
});
warn(
  "registration reveals existing emails",
  duplicate.status !== 409,
  duplicate.status === 409
    ? "returns 409 for an existing email; this is an account-enumeration signal"
    : "",
);

const loginLimitEmail = email("login-limit");
let lastLogin;
for (let index = 0; index < 11; index++) {
  lastLogin = await anonymous.req("/api/auth/login", {
    method: "POST",
    useCookie: false,
    headers: { "X-Real-IP": "198.51.100.10" },
    body: { email: loginLimitEmail, password: "wrong password" },
  });
}
check("login rate limit triggers", lastLogin.status === 429, String(lastLogin.status));
check(
  "rate limit includes Retry-After",
  !!lastLogin.headers.get("retry-after"),
);

let registerLimited = false;
for (let index = 0; index < 11; index++) {
  const response = await anonymous.req("/api/auth/register", {
    method: "POST",
    useCookie: false,
    headers: { "X-Real-IP": "198.51.100.20" },
    body: {
      name: `Rate ${index}`,
      email: email(`rate-${index}`),
      password,
      timezone: "UTC",
    },
  });
  if (response.status === 429) {
    registerLimited = true;
    break;
  }
}
check("registration rate limit triggers", registerLimited);

// Demonstrate that per-IP limits depend on trusted proxy headers.
let sameIpBlocked = false;
for (let index = 0; index < 31; index++) {
  const response = await anonymous.req("/api/auth/login", {
    method: "POST",
    useCookie: false,
    headers: { "X-Real-IP": "198.51.100.30" },
    body: { email: email(`spoof-same-${index}`), password: "wrong password" },
  });
  if (response.status === 429) {
    sameIpBlocked = true;
    break;
  }
}
check("per-IP limit applies with a stable client key", sameIpBlocked);
let rotatedBlocked = false;
for (let index = 0; index < 31; index++) {
  const response = await anonymous.req("/api/auth/login", {
    method: "POST",
    useCookie: false,
    headers: { "X-Real-IP": `198.51.100.${100 + index}` },
    body: { email: email(`spoof-rotate-${index}`), password: "wrong password" },
  });
  if (response.status === 429) {
    rotatedBlocked = true;
    break;
  }
}
warn(
  "per-IP limits trust proxy headers",
  !rotatedBlocked,
  rotatedBlocked
    ? ""
    : "rotating X-Real-IP avoids the per-IP bucket; ensure a trusted proxy overwrites it",
);

// Logout and session invalidation.
const logout = await a.req("/api/auth/logout", { method: "POST", body: {} });
check("logout succeeds", logout.status === 200);
check(
  "logout clears the cookie",
  logout.setCookie.some(
    (value) => /one_percent_session=;/.test(value) && /Max-Age=0/i.test(value),
  ),
);
const afterLogout = await a.req("/api/dashboard");
check("logout invalidates the session", afterLogout.status === 401);

// Final summary.
const failures = results.filter((item) => !item.ok && !item.warning);
const warnings = results.filter((item) => !item.ok && item.warning);
console.log(
  `\n${results.length - failures.length - warnings.length}/${results.length} checks passed, ${warnings.length} warning(s), ${failures.length} failure(s).`,
);
if (failures.length) {
  console.error("\nFailures:");
  for (const failure of failures) console.error(`- ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
