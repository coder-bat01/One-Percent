import test from "node:test";
import assert from "node:assert/strict";
import { clientKey, rateLimit } from "../src/server/rate-limit";

test("rate limiting blocks after the limit, resets, and reports retry time", (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-03-02T12:00:00Z"),
  });
  const key = `rate-limit-test-${Math.random()}`;
  assert.equal(rateLimit(key, 2, 60_000).allowed, true);
  assert.equal(rateLimit(key, 2, 60_000).allowed, true);
  const blocked = rateLimit(key, 2, 60_000);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfter > 0 && blocked.retryAfter <= 60);
  t.mock.timers.setTime(new Date("2026-03-02T12:01:01Z").getTime());
  assert.equal(rateLimit(key, 2, 60_000).allowed, true);
});

test("global rate-limit buckets are isolated from client buckets", (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-03-02T12:00:00Z"),
  });
  const globalKey = `global-limit-test-${Math.random()}`;
  const clientKey = `client-limit-test-${Math.random()}`;
  assert.equal(rateLimit(globalKey, 1, 60_000, { global: true }).allowed, true);
  assert.equal(rateLimit(globalKey, 1, 60_000, { global: true }).allowed, false);
  assert.equal(rateLimit(clientKey, 1, 60_000).allowed, true);
  assert.equal(rateLimit(clientKey, 1, 60_000).allowed, false);
});

test("a flood of client buckets cannot clear global limits", (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-03-02T12:00:00Z"),
  });
  const globalKey = `global-flood-test-${Math.random()}`;
  assert.equal(rateLimit(globalKey, 1, 60_000, { global: true }).allowed, true);
  assert.equal(rateLimit(globalKey, 1, 60_000, { global: true }).allowed, false);
  for (let index = 0; index < 10_050; index++)
    rateLimit(`flood-${index}-${Math.random()}`, 1, 60_000);
  assert.equal(rateLimit(globalKey, 1, 60_000, { global: true }).allowed, false);
});

test("client key prefers the proxy's real IP header", () => {
  assert.equal(
    clientKey({
      headers: new Headers({
        "x-forwarded-for": "203.0.113.10, 10.0.0.1",
        "x-real-ip": "198.51.100.4",
      }),
    }),
    "198.51.100.4",
  );
  assert.equal(
    clientKey({
      headers: new Headers({
        "x-forwarded-for": "203.0.113.10, 10.0.0.1",
      }),
    }),
    "203.0.113.10",
  );
  assert.equal(
    clientKey({ headers: new Headers({ "x-real-ip": "198.51.100.4" }) }),
    "198.51.100.4",
  );
  assert.equal(clientKey({ headers: new Headers() }), "unknown");
});
