const COMPANY_ALIASES = [
  { pattern: /\bapple(?:\s+inc\.?|\s+corporation)?\b/i, company: "Apple Inc.", ticker: "AAPL" },
];

function extractCompanyAndTicker(question, filters) {
  for (const alias of COMPANY_ALIASES) {
    if (alias.pattern.test(question)) {
      filters.company = alias.company;
      filters.ticker = alias.ticker;
      return;
    }
  }

  const ticker = question.match(/\b([A-Z]{1,5})\b/);
  if (ticker && ticker[1] === "AAPL") {
    filters.ticker = ticker[1];
  }
}

function extractFilingType(question, filters) {
  const match = question.match(/\b10\s*[- ]?([KQ])\b/i);
  if (match) {
    filters.filingType = `10-${match[1].toUpperCase()}`;
  }
}

function extractItem(question, filters) {
  const match = question.match(/\bitem\s+(\d{1,2}[A-Z]?)\b/i);
  if (match) {
    filters.item = match[1].toUpperCase();
  }
}

function extractDate(question, filters) {
  const date = question.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const year = question.match(/\b(20\d{2})\b/);
  const filingContext = /\b(filing|filed|10\s*[- ]?[KQ])\b/i.test(question);
  const reportContext = /\b(report(?:ing)?\s+date|reporting\s+period|fiscal\s+year|year\s+ended|annual\s+report)\b/i.test(question);

  if (!date && !year) return;

  const value = date?.[1] || year?.[1];
  if (filingContext && !reportContext) {
    filters.filingDate = value;
  } else if (reportContext && !filingContext) {
    filters.reportDate = value;
  }
}

export function extractQueryFilters(question = "") {
  if (typeof question !== "string" || !question.trim()) return {};

  const filters = {};
  extractCompanyAndTicker(question, filters);
  extractFilingType(question, filters);
  extractItem(question, filters);
  extractDate(question, filters);
  return filters;
}
