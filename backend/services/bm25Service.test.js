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
  const unfiltered = searchBM25("What products does Apple sell?", 10);
  const results = searchBM25("What products does Apple sell?", 10, { ticker: "AAPL" });
  assert.deepEqual(results.map((result) => result.id), unfiltered.map((result) => result.id));
  assert.ok(results.length > 0);
  assert.ok(results.every((result) => result.metadata.ticker === "AAPL"));
  assert.ok(results.every((result) => typeof result.bm25Score === "number"));
});

test("BM25 supports the production candidate count of 20", () => {
  const results = searchBM25("What are Apple's main business risks?", 20);
  assert.equal(results.length, 20);
  assert.ok(results.every((result) => typeof result.bm25Score === "number"));
});

test("BM25 applies all supported metadata filters exactly", () => {
  const results = searchBM25("What are Apple's main business risks?", 10, {
    ticker: "AAPL",
    company: "Apple Inc.",
    filingType: "10-K",
    filingDate: "2025-10-31",
    reportDate: "2025-09-27",
    item: "1A",
    section: "Item 1A",
  });

  assert.ok(results.length > 0);
  assert.ok(results.every((result) => (
    result.metadata.ticker === "AAPL" &&
    result.metadata.company === "Apple Inc." &&
    result.metadata.filingType === "10-K" &&
    result.metadata.filingDate === "2025-10-31" &&
    result.metadata.reportDate === "2025-09-27" &&
    result.metadata.item === "1A" &&
    result.metadata.section === "Item 1A"
  )));
});
