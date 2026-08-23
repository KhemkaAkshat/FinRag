import test from "node:test";
import assert from "node:assert/strict";
import { requestIngestion, resetIngestionQueueForTests } from "./ingestionQueue.js";

test("ingestion queue deduplicates active requests and exposes progress", async () => {
  resetIngestionQueueForTests();
  const company = { cik: "0000000001", ticker: "TEST", name: "Test Holdings" };
  let release;
  const ingest = async ({ onProgress }) => { onProgress({ status: "INDEXING", totalChunks: 4, completedChunks: 2 }); await new Promise((resolve) => { release = resolve; }); };
  const options = { company, forms: ["10-K"], ingest, getStatus: async () => ({ indexed: false }) };
  const first = await requestIngestion(options);
  const second = await requestIngestion(options);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.job.id, first.job.id);
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  resetIngestionQueueForTests();
});
