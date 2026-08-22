import test from "node:test";
import assert from "node:assert/strict";
import { rerankLocal, rerankWithCohere } from "./rerankerService.js";

const document = (id, text, metadata = {}) => ({
  id,
  text,
  metadata,
  rrfScore: 0.01,
  vectorScore: 0.7,
  bm25Score: 4,
});

test("reranker promotes documents matching the full query", () => {
  const results = rerankLocal("Apple research and development expenses", [
    document("generic", "Apple sells phones and computers."),
    document("match", "Apple reported research and development expenses in its annual filing."),
  ], 2);

  assert.deepEqual(results.map((result) => result.id), ["match", "generic"]);
  assert.equal(results[0].rrfScore, 0.01);
  assert.equal(results[0].vectorScore, 0.7);
  assert.equal(results[0].bm25Score, 4);
  assert.ok(results[0].rerankScore > results[1].rerankScore);
});

test("reranker applies topK and preserves document payloads", () => {
  const results = rerankLocal("revenue", [
    document("one", "Revenue increased."),
    document("two", "Operating expenses increased."),
    document("three", "Revenue declined."),
  ], 2);

  assert.equal(results.length, 2);
  assert.equal(results[0].id, "one");
  assert.deepEqual(results[0].metadata, {});
  assert.equal(results[0].text, "Revenue increased.");
});

test("reranker is deterministic for tied documents", () => {
  const results = rerankLocal("unmatched query", [document("first", "No matching terms."), document("second", "No matching terms.")], 2);
  assert.deepEqual(results.map((result) => result.id), ["first", "second"]);
});

test("Cohere reranker maps mocked indexes and preserves document fields", async () => {
  let request;
  const client = {
    rerank: async (payload) => {
      request = payload;
      return { results: [
        { index: 1, relevanceScore: 0.91 },
        { index: 0, relevanceScore: 0.22 },
      ] };
    },
  };
  const documents = [document("first", "First filing"), document("second", "Second filing")];
  const results = await rerankWithCohere("What is revenue?", documents, 2, client);

  assert.equal(request.model, "rerank-v4.0-fast");
  assert.equal(request.topN, 2);
  assert.equal(request.returnDocuments, undefined);
  assert.deepEqual(results.map((result) => result.id), ["second", "first"]);
  assert.equal(results[0].cohereScore, 0.91);
  assert.equal(results[0].rrfScore, 0.01);
  assert.equal(results[0].vectorScore, 0.7);
  assert.equal(results[0].bm25Score, 4);
  assert.equal(results[0].text, "Second filing");
});
