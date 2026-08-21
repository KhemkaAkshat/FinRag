import test from "node:test";
import assert from "node:assert/strict";
import { reciprocalRankFusion, matchesMetadata } from "./retrievalService.js";

const vector = (id, score, metadata = {}, text = `vector ${id}`) => ({ id, score, metadata, text });
const lexical = (id, score, metadata = {}, text = `bm25 ${id}`) => ({ id, bm25Score: score, metadata, text });

test("RRF keeps a Pinecone-only result and its vector score", () => {
  const [result] = reciprocalRankFusion([vector("v1", 0.91, { ticker: "AAPL" })], [], 5);
  assert.equal(result.id, "v1");
  assert.equal(result.vectorScore, 0.91);
  assert.equal(result.bm25Score, undefined);
  assert.equal(result.rrfScore, 1 / 61);
});

test("RRF keeps a BM25-only result and its lexical score", () => {
  const [result] = reciprocalRankFusion([], [lexical("b1", 12, { ticker: "AAPL" })], 5);
  assert.equal(result.id, "b1");
  assert.equal(result.bm25Score, 12);
  assert.equal(result.vectorScore, undefined);
  assert.equal(result.rrfScore, 1 / 61);
});

test("RRF merges duplicate IDs and preserves both result payloads", () => {
  const [result] = reciprocalRankFusion(
    [vector("same", 0.8, { ticker: "AAPL" }, "filing text")],
    [lexical("same", 7, { company: "Apple Inc." }, "lexical text")],
    5,
  );
  assert.equal(result.id, "same");
  assert.equal(result.vectorScore, 0.8);
  assert.equal(result.bm25Score, 7);
  assert.equal(result.metadata.ticker, "AAPL");
  assert.equal(result.metadata.company, "Apple Inc.");
  assert.equal(result.text, "filing text");
  assert.equal(result.rrfScore, 2 / 61);
});

test("RRF uses rank scores and applies topK", () => {
  const results = reciprocalRankFusion(
    [vector("a", 0.99), vector("b", 0.98)],
    [lexical("b", 2), lexical("c", 1)],
    2,
  );
  assert.deepEqual(results.map((result) => result.id), ["b", "a"]);
  assert.equal(results[0].rrfScore, 1 / 61 + 1 / 62);
  assert.equal(results[1].rrfScore, 1 / 61);
});

test("metadata matching uses exact optional fields", () => {
  assert.equal(matchesMetadata({ ticker: "AAPL", item: "1" }, { ticker: "AAPL" }), true);
  assert.equal(matchesMetadata({ ticker: "AAPL", item: "1" }, { item: "7" }), false);
  assert.equal(matchesMetadata({ ticker: "AAPL" }, {}), true);
});

