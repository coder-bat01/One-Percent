// Live production verification. Run against a deployed instance:
//
//   LIVE_BASE_URL=https://your-app.onrender.com node scripts/live-check.mjs
//
// The script creates test accounts and data. On a diskless free-tier instance
// that data is ephemeral; on a persistent-disk instance use a throwaway
// database or accept the test rows in your real database.

const base = process.env.LIVE_BASE_URL;
if (!base || !/^https:\/\//.test(base)) {
  console.error("Set LIVE_BASE_URL to the https:// URL of the deployed app.");
  process.exit(1);
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
const password = "correct horse battery staple";

function client() {
  let cookie = "";
  return {
    get cookie() {
      return cookie;
    },
    async req(path, { method = "GET", body, headers = {} } = {}) {
      const h = { ...headers };
      if (body !== undefined) {
        h["Content-Type"] = "application/json";
        h.Origin = base;
      }
      if (cookie) h.Cookie = cookie;
      const response = await fetch(base + path, {
        method,
        headers: h,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
      });
      for (const value of response.headers.getSetCookie()) {
        const pair = value.split(";")[0];
        if (pair.startsWith("one_percent_session=")) cookie = pair;
      }
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      return { status: response.status, headers: response.headers, data, text, setCookie: response.headers.getSetCookie() };
    },
    async registerOrLogin(email) {
      let r = await this.req("/api/auth/register", {
        method: "POST",
        body: { name: "Live Check", email, password, timezone: "UTC" },
      });
      if (r.status === 409)
        r = await this.req("/api/auth/login", { method: "POST", body: { email, password } });
      return r;
    },
  };
}

const host = new URL(base).host;

// Transport
const httpResp = await fetch(`http://${host}/api/health`, { redirect: "manual" });
check("HTTP redirects to HTTPS", httpResp.status === 301 || httpResp.status === 308, String(httpResp.status));
const home = await fetch(base + "/", { redirect: "manual" });
const csp = home.headers.get("content-security-policy") || "";
check("home page 200", home.status === 200);
check("CSP present", csp.includes("default-src 'self'"));
check("CSP frame-ancestors 'none'", csp.includes("frame-ancestors 'none'"));
check("HSTS present", (home.headers.get("strict-transport-security") || "").includes("max-age="));
check("X-Frame-Options DENY", home.headers.get("x-frame-options") === "DENY");
check("nosniff", home.headers.get("x-content-type-options") === "nosniff");
check("Referrer-Policy same-origin", home.headers.get("referrer-policy") === "same-origin");
check("COOP same-origin", home.headers.get("cross-origin-opener-policy") === "same-origin");
check("no X-Powered-By", !home.headers.has("x-powered-by"));
check("no CORS header", !home.headers.has("access-control-allow-origin"));
const health = await fetch(base + "/api/health");
const healthData = await health.json();
check("health endpoint ok", health.status === 200 && healthData.ok === true);
check("health no-store", health.headers.get("cache-control") === "no-store");

// Auth + cookie flags
const run = `live-${Date.now()}`;
const a = client();
const regA = await a.registerOrLogin(`live-check-a@example.com`);
check("account A ready", regA.status === 200, String(regA.status));
const cookieHeader = regA.setCookie.join("; ");
check("cookie HttpOnly", /HttpOnly/i.test(cookieHeader));
check("cookie Secure", /Secure/i.test(cookieHeader));
check("cookie SameSite=Lax", /SameSite=Lax/i.test(cookieHeader));

// CSRF
const csrf = await fetch(base + "/api/auth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
  body: JSON.stringify({ name: "x", email: `${run}-csrf@example.com`, password, timezone: "UTC" }),
});
check("cross-origin POST rejected", csrf.status === 403, String(csrf.status));

// Task round-trip
const dash = await a.req("/api/dashboard");
check("dashboard reads", dash.status === 200 && !!dash.data.date);
const save = await a.req("/api/tasks/save", {
  method: "POST",
  body: {
    title: "Live smoke task",
    description: '<script>window.__liveXss=1</script>',
    type: "count", target: 10, unit: "pages",
    schedule: { kind: "daily", days: [] },
    startDate: dash.data.date, endDate: null, partyId: null,
  },
});
check("task created", save.status === 200, String(save.status));
const dash2 = await a.req("/api/dashboard");
check("dashboard response is JSON", (dash2.headers.get("content-type") || "").includes("application/json"));
check("XSS title stored as exact data", dash2.data.tasks?.some((t) => t.title === "Live smoke task"));
check("XSS description stored as exact data", dash2.data.tasks?.some((t) => t.description === '<script>window.__liveXss=1</script>'));

// Party + invite + member + registered outsider
const b = client();
const regB = await b.registerOrLogin(`live-check-b@example.com`);
check("account B ready", regB.status === 200, String(regB.status));
const c = client();
const regC = await c.registerOrLogin(`live-check-c@example.com`);
check("account C ready", regC.status === 200, String(regC.status));

const party = await a.req("/api/parties", { method: "POST", body: { name: "Live party", description: "" } });
const partyId = party.data.party?.id;
check("party created", party.status === 200 && !!partyId);
const invite = await a.req(`/api/parties/${partyId}/invites`, { method: "POST", body: {} });
check("invite created", invite.status === 200 && !!invite.data.token);
const joined = await b.req(`/api/invites/${encodeURIComponent(invite.data.token)}/join`, { method: "POST", body: {} });
check("invite join works", joined.status === 200, String(joined.status));
const outsider = await c.req(`/api/parties/${partyId}`);
check("registered outsider blocked from party", outsider.status === 404, String(outsider.status));

// SSE live sync: A listens, B mutates a shared task
const sseController = new AbortController();
const sse = await fetch(base + "/api/events", { headers: { Cookie: a.cookie }, signal: sseController.signal });
check("SSE opens", sse.status === 200, String(sse.status));
const reader = sse.body.getReader();
let buffer = "";
const pump = (async () => {
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += new TextDecoder().decode(value, { stream: true });
    }
  } catch { /* aborted */ }
})();
async function waitFor(marker, timeoutMs) {
  const started = Date.now();
  for (;;) {
    if (buffer.includes(marker)) return true;
    if (Date.now() - started > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
}
check("SSE connected event", await waitFor(": connected", 8000));

const bShared = await b.req("/api/tasks/save", {
  method: "POST",
  body: {
    title: "Live shared task", description: "", type: "binary", target: 1, unit: "",
    schedule: { kind: "daily", days: [] }, startDate: dash.data.date, endDate: null, partyId,
  },
});
check("member creates shared task", bShared.status === 200, String(bShared.status));
check("SSE refresh on shared mutation", await waitFor("event: refresh", 8000));
sseController.abort();
await pump;
check("SSE carries no task data", !buffer.includes("Live smoke task") && !buffer.includes("Live shared task"));

// Unknown route (while authenticated)
const unknown = await a.req("/api/does-not-exist");
check("unknown API JSON 404", unknown.status === 404 && !!unknown.data.error);

// Logout invalidation (last: clears the session)
const logout = await a.req("/api/auth/logout", { method: "POST", body: {} });
check("logout works", logout.status === 200);
const afterLogout = await a.req("/api/dashboard");
check("session invalidated", afterLogout.status === 401, String(afterLogout.status));

const failures = results.filter((r) => !r.ok);
console.log(`\n${results.length - failures.length}/${results.length} live checks passed.`);
if (failures.length) {
  for (const f of failures) console.error(`- ${f.name}`);
  process.exit(1);
}
