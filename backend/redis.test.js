import test from "node:test";
import assert from "node:assert/strict";
import { createRedisCache } from "./services/redisService.js";
import { createRedisRateLimiter } from "./middleware/rateLimit.js";

test("Redis cache serializes values and preserves TTL", async () => {
  const calls = [];
  const values = new Map();
  const client = { isReady: true, async get(key) { return values.get(key) ?? null; }, async set(key, value, options) { calls.push({ key, options }); values.set(key, value); } };
  const cache = createRedisCache({ client, ttlMs: 1234 });
  await cache.set("question", { answer: "ok" });
  assert.deepEqual(await cache.get("question"), { answer: "ok" });
  assert.equal(calls[0].options.PX, 1234);
});

test("Redis cache falls back without throwing when Redis fails", async () => {
  const client = { isReady: true, async get() { throw new Error("offline"); }, async set() { throw new Error("offline"); } };
  const cache = createRedisCache({ client });
  assert.equal(await cache.get("question"), undefined);
  await assert.doesNotReject(() => cache.set("question", { answer: "ok" }));
});

test("Redis rate limiter uses atomic counter and returns 429", async () => {
  let count = 0;
  const redis = { isReady: true, async incr() { return ++count; }, async pExpire() {} };
  const middleware = createRedisRateLimiter({ windowMs: 60000, max: 1, redis });
  const makeResponse = () => ({ headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; } });
  const first = makeResponse(); let nextCalled = false;
  await middleware({ ip: "127.0.0.1" }, first, () => { nextCalled = true; });
  const second = makeResponse();
  await middleware({ ip: "127.0.0.1" }, second, () => {});
  assert.equal(nextCalled, true);
  assert.equal(second.code, 429);
  assert.equal(second.body.error.code, "RATE_LIMITED");
});
