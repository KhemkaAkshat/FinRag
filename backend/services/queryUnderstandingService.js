function extractFilingType(question, filters) {
  const match = question.match(/\b10\s*[- ]?([KQ])\b/i);
  if (match) filters.filingType = `10-${match[1].toUpperCase()}`;
}

function extractItem(question, filters) {
  const match = question.match(/\bitem\s+(\d{1,2}[A-Z]?)\b/i);
  if (match) filters.item = match[1].toUpperCase();
}

function extractDate(question, filters) {
  const date = question.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const year = question.match(/\b(20\d{2})\b/);
  const filingContext = /\b(filing|filed|10\s*[- ]?[KQ])\b/i.test(question);
  const reportContext = /\b(report(?:ing)?\s+date|reporting\s+period|fiscal\s+year|year\s+ended|annual\s+report)\b/i.test(question);
  if (!date && !year) return;
  const value = date?.[1] || year?.[1];
  if (filingContext && !reportContext) filters.filingDate = value;
  else if (reportContext && !filingContext) filters.reportDate = value;
}

export function extractQueryFilters(question = "") {
  if (typeof question !== "string" || !question.trim()) return {};
  const filters = {};
  extractFilingType(question, filters);
  extractItem(question, filters);
  extractDate(question, filters);
  return filters;
}
