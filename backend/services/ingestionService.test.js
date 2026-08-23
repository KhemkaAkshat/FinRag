import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { ingestCompany } from "./ingestionService.js";

test("company ingestion stages documents and resumes after a Pinecone failure", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "finrag-ingestion-"));
  const statePath = path.join(root, "state.json");
  const stagingRoot = path.join(root, "staging");
  const company = { cik: "0000000001", ticker: "TEST", name: "Test Holdings" };
  const filing = { form: "10-K", filingDate: "2026-01-01", reportDate: "2025-12-31", accessionNumber: "0000000001-26-000001", primaryDocument: "test.htm" };
  let storeCalls = 0;
  const dependencies = {
    findCompany: async () => [company],
    getFinancialFilings: async () => ({ company: company.name, cik: company.cik, ticker: [company.ticker], filings: [filing] }),
    downloadFiling: async () => ({ url: "https://sec.example/test.htm", html: "<html />" }),
    extractTextFromHtml: () => "test filing text",
    extractSections: () => [{ item: "1", title: "Business", text: "Test filing content" }],
    createRagDocuments: async () => [{ pageContent: "Test filing content", metadata: { item: "1", section: "Business" } }],
    storeDocuments: async () => { storeCalls += 1; if (storeCalls === 1) throw new Error("Pinecone unavailable"); },
    appendBM25Index: async () => {},
  };
  await assert.rejects(() => ingestCompany({ searchTerm: "TEST", forms: ["10-K"], dependencies, paths: { statePath, stagingRoot } }), /Pinecone unavailable/);
  const failedState = JSON.parse(await fs.readFile(statePath, "utf8"));
  assert.equal(failedState[company.cik].filings["10-K:0000000001-26-000001"].status, "pinecone_in_progress");
  await ingestCompany({ searchTerm: "TEST", forms: ["10-K"], dependencies, paths: { statePath, stagingRoot } });
  const completeState = JSON.parse(await fs.readFile(statePath, "utf8"));
  assert.equal(completeState[company.cik].filings["10-K:0000000001-26-000001"].status, "complete");
  assert.equal(storeCalls, 2);
  await fs.rm(root, { recursive: true, force: true });
});
