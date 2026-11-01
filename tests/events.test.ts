import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CONNECTIONS_PER_USER,
  acquireConnection,
  releaseConnection,
} from "../src/server/events";

test("SSE connections are capped per user", () => {
  const userId = `sse-cap-${Math.random()}`;
  for (let index = 0; index < MAX_CONNECTIONS_PER_USER; index++)
    assert.equal(acquireConnection(userId), true);
  assert.equal(acquireConnection(userId), false);
  releaseConnection(userId);
  assert.equal(acquireConnection(userId), true);
  for (let index = 0; index < MAX_CONNECTIONS_PER_USER; index++)
    releaseConnection(userId);
  assert.equal(acquireConnection(userId), true);
  releaseConnection(userId);
});
