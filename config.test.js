import test from "node:test";
import assert from "node:assert/strict";
import { getConfig, getOperationalSettings } from "./config.js";

const validEnv = {
  GEMINI_API_KEY: "gemini-test",
  PINECONE_API_KEY: "pinecone-test",
  PINECONE_INDEX_NAME: "finrag",
};

test("config validates production settings and applies safe defaults", () => {
  const config = getConfig(validEnv);
  assert.equal(config.port, 5000);
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.requestTimeoutMs, 30000);
  assert.equal(config.rateLimitMax, 30);
  assert.equal(config.cacheMaxEntries, 100);
});

test("config rejects invalid timeout and rate limit settings", () => {
  assert.throws(() => getOperationalSettings({ UPSTREAM_TIMEOUT_MS: "0" }), /UPSTREAM_TIMEOUT_MS/);
  assert.throws(() => getOperationalSettings({ RATE_LIMIT_MAX: "nope" }), /RATE_LIMIT_MAX/);
});

test("config requires provider credentials", () => {
  assert.throws(() => getConfig({}), /GEMINI_API_KEY, PINECONE_API_KEY, PINECONE_INDEX_NAME/);
});
