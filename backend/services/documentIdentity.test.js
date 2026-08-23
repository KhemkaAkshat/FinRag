import test from "node:test";
import assert from "node:assert/strict";
import { stableDocumentId, filingKey } from "./documentIdentity.js";

test("stable document IDs are deterministic and filing-scoped", () => {
  const input = { cik: "320193", accessionNumber: "0000320193-25-000001", chunkIndex: 42 };
  assert.equal(stableDocumentId(input), stableDocumentId(input));
  assert.equal(stableDocumentId(input), "finrag-0000320193-000032019325000001-00042");
  assert.notEqual(stableDocumentId({ ...input, chunkIndex: 43 }), stableDocumentId(input));
  assert.equal(filingKey({ form: "10-K", accessionNumber: input.accessionNumber }), "10-K:0000320193-25-000001");
});
