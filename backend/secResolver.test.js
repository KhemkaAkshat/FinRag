import test from "node:test";
import assert from "node:assert/strict";
import { resolveCompanyInDirectory, resolveCompanyReference } from "./services/secService.js";

const companies = [
  { cik: "0000320193", ticker: "AAPL", name: "Apple Inc." },
  { cik: "0001418121", ticker: "APLE", name: "Apple Hospitality REIT, Inc." },
  { cik: "0001000001", ticker: "ACMH", name: "Acme Holdings, Inc." },
  { cik: "0001000002", ticker: "ACMT", name: "Acme Technologies, Inc." },
];

async function resolve(question) {
  return resolveCompanyReference(question, { force: true, fetchImpl: async () => ({ ok: true, json: async () => Object.fromEntries(companies.map((company, index) => [index, { cik_str: company.cik, ticker: company.ticker, title: company.name }])) }) });
}

test("Apple resolves to Apple Inc. rather than Apple Hospitality", async () => {
  const result = await resolve("What are Apple's main business risks?");
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.company.ticker, "AAPL");
});

test("exact tickers resolve directly", async () => {
  assert.equal((await resolve("AAPL")).company.ticker, "AAPL");
  assert.equal((await resolve("APLE")).company.ticker, "APLE");
});

test("similarly strong partial names are ambiguous", async () => {
  const result = await resolve("Acme");
  assert.equal(result.status, "AMBIGUOUS");
  assert.deepEqual(result.candidates.map(({ name, ticker, cik }) => ({ name, ticker, cik })), [
    { name: "Acme Holdings, Inc.", ticker: "ACMH", cik: "0001000001" },
    { name: "Acme Technologies, Inc.", ticker: "ACMT", cik: "0001000002" },
  ]);
});

test("nonexistent companies are not silently treated as a match", async () => {
  const result = await resolve("Nimbly Financial");
  assert.equal(result.status, "NOT_FOUND");
  assert.deepEqual(result.candidates, []);
});

test("existing indexed-company ordering remains deterministic", () => {
  assert.equal(resolveCompanyInDirectory("Apple", companies)[0].ticker, "AAPL");
});
