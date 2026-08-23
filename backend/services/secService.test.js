import test from "node:test";
import assert from "node:assert/strict";
import { resolveCompanyInDirectory, searchCompanyDirectory, companyCandidatesFromQuestion } from "./secService.js";

const companies = [
  { cik: "0000000001", ticker: "AAPL", name: "Apple Inc." },
  { cik: "0000000002", ticker: "MSFT", name: "Microsoft Corporation" },
  { cik: "0000000003", ticker: "META", name: "Meta Platforms, Inc." },
];

test("company directory resolves ticker and exact names without a fixed company list", () => {
  assert.deepEqual(searchCompanyDirectory("msft", companies), [companies[1]]);
  assert.deepEqual(searchCompanyDirectory("Microsoft Corporation", companies), [companies[1]]);
});

test("company question resolution finds dynamic company references", () => {
  assert.ok(companyCandidatesFromQuestion("Summarize Apple's latest 10-K risks").includes("Apple"));
  assert.deepEqual(resolveCompanyInDirectory("Summarize Apple's latest 10-K risks", companies), [companies[0]]);
  assert.deepEqual(resolveCompanyInDirectory("What are the main risks?", companies), []);
});
