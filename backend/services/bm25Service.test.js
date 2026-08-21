import test from "node:test";
import assert from "node:assert/strict";
import { loadBM25Index, searchBM25, getBM25DocumentCount } from "./bm25Service.js";

test("BM25 loads the serialized index and reuses it", async () => {
  const firstLoad = await loadBM25Index();
  const countAfterFirstLoad = getBM25DocumentCount();
  const secondLoad = await loadBM25Index();
  assert.equal(firstLoad, true);
  assert.equal(secondLoad, true);
  assert.equal(countAfterFirstLoad, 208);
  assert.equal(getBM25DocumentCount(), countAfterFirstLoad);
});

test("BM25 searches without calling Gemini and applies metadata filters", () => {
  const results = searchBM25("What products does Apple sell?", 10, { ticker: "AAPL" });
  assert.ok(results.length > 0);
  assert.ok(results.every((result) => result.metadata.ticker === "AAPL"));
  assert.ok(results.every((result) => typeof result.bm25Score === "number"));
});

