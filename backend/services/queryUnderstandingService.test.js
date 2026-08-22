import test from "node:test";
import assert from "node:assert/strict";
import { extractQueryFilters } from "./queryUnderstandingService.js";

test("extracts company, ticker, filing type, item, and filing date", () => {
  assert.deepEqual(
    extractQueryFilters("What were Apple's risks in Item 1A of its 10-K filed on 2025-10-31?"),
    {
      company: "Apple Inc.",
      ticker: "AAPL",
      filingType: "10-K",
      item: "1A",
      filingDate: "2025-10-31",
    },
  );
});

test("extracts report date for a fiscal-year question", () => {
  assert.deepEqual(
    extractQueryFilters("How did revenue change in the fiscal year 2025 report?"),
    { reportDate: "2025" },
  );
});

test("extracts 10-Q and numeric item references", () => {
  assert.deepEqual(
    extractQueryFilters("Summarize Item 7 from Apple's 10 Q."),
    { company: "Apple Inc.", ticker: "AAPL", filingType: "10-Q", item: "7" },
  );
});

test("leaves ambiguous questions unfiltered", () => {
  assert.deepEqual(extractQueryFilters("What is the company doing recently?"), {});
  assert.deepEqual(extractQueryFilters("What happened in 2025?"), {});
  assert.deepEqual(extractQueryFilters(""), {});
});
