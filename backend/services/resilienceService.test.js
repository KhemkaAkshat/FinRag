import test from "node:test";
import assert from "node:assert/strict";
import { createSingleFlightCache, createTtlCache, withRetry, withTimeout } from "./resilienceService.js";

test("withTimeout rejects slow operations", async () => {
  await assert.rejects(
    withTimeout(() => new Promise(() => {}), 5),
    (error) => error.code === "UPSTREAM_TIMEOUT" && error.statusCode === 504,
  );
});

test("withRetry retries transient 429 errors with backoff", async () => {
  let attempts = 0;
  const delays = [];
  const result = await withRetry(() => {
    attempts += 1;
    if (attempts < 3) throw Object.assign(new Error("busy"), { status: 429 });
    return "ok";
  }, { maxAttempts: 3, sleep: async (delay) => delays.push(delay), logger: { info() {}, warn() {}, error() {} } });

  assert.equal(result, "ok");
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [250, 500]);
});

test("withRetry exposes safe quota errors after retries", async () => {
  await assert.rejects(
    withRetry(() => { throw Object.assign(new Error("quota exceeded"), { status: 429 }); }, { maxAttempts: 1, logger: { info() {}, warn() {}, error() {} } }),
    (error) => error.code === "UPSTREAM_QUOTA" && error.publicMessage === "Upstream provider quota exceeded.",
  );
});

test("single-flight cache deduplicates concurrent work and caches success", async () => {
  const cache = createSingleFlightCache({
    cache: createTtlCache({ ttlMs: 1000 }),
    keyFor: (value) => value.trim().toLowerCase(),
  });
  let calls = 0;
  const factory = async () => { calls += 1; await Promise.resolve(); return { answer: "ok" }; };

  const results = await Promise.all([cache.getOrCreate(" Question ", factory), cache.getOrCreate("question", factory)]);
  assert.equal(calls, 1);
  assert.deepEqual(results[0], results[1]);
  await cache.getOrCreate("QUESTION", factory);
  assert.equal(calls, 1);
});
