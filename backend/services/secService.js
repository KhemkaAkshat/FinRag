import "dotenv/config";

const SEC_COMPANY_URL = "https://www.sec.gov/files/company_tickers.json";
const SEC_SUBMISSIONS_URL = "https://data.sec.gov/submissions";
const SEC_ARCHIVES_URL = "https://www.sec.gov/Archives/edgar/data";
const DIRECTORY_TTL_MS = Number(process.env.SEC_COMPANY_CACHE_TTL_MS || 86400000);
let directoryCache;
let directoryPromise;

function secHeaders() {
  return { "User-Agent": process.env.SEC_USER_AGENT || "FinRAG contact@example.com" };
}

export function normalizeCompanyName(value = "") {
  return String(value).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

const LEGAL_SUFFIXES = new Set("inc incorporated corp corporation co company plc ltd limited llc".split(" "));

function normalize(value = "") { return normalizeCompanyName(value); }

function canonicalCompanyName(value = "") {
  const tokens = normalizeCompanyName(value).split(" ").filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(" ");
}

function toCompany(company) {
  return { cik: String(company.cik_str ?? company.cik ?? "").padStart(10, "0"), ticker: String(company.ticker || "").toUpperCase(), name: company.title || company.name };
}

export async function getCompanyDirectory({ fetchImpl = fetch, force = false } = {}) {
  if (!force && directoryCache && directoryCache.expiresAt > Date.now()) return directoryCache.companies;
  if (directoryPromise && !force) return directoryPromise;
  directoryPromise = fetchImpl(SEC_COMPANY_URL, { headers: secHeaders() }).then(async (response) => {
    if (!response.ok) throw new Error(`SEC request failed: ${response.status}`);
    const payload = await response.json();
    const companies = Object.values(payload).map(toCompany).filter((company) => company.cik && company.name);
    directoryCache = { companies, expiresAt: Date.now() + DIRECTORY_TTL_MS };
    return companies;
  }).finally(() => { directoryPromise = null; });
  return directoryPromise;
}

export function searchCompanyDirectory(searchTerm, companies = []) {
  const search = normalize(searchTerm);
  if (!search) return [];
  const exactTicker = companies.filter((company) => normalize(company.ticker) === search);
  if (exactTicker.length) return exactTicker;
  const exactName = companies.filter((company) => normalize(company.name) === search);
  if (exactName.length) return exactName;
  const terms = new Set(search.split(" ").filter(Boolean));
  return companies.filter((company) => normalize(company.name).split(" ").some((term) => terms.has(term)));
}

export async function findCompany(searchTerm, options = {}) {
  return searchCompanyDirectory(searchTerm, await getCompanyDirectory(options));
}

const QUERY_STOP_WORDS = new Set("a an and are ask about answer answers as at be business by can company compare did does filing filings for from had has have how in is latest main more of on or revenue risk risks summarize the their this to what were with year your inc incorporated corp corporation co plc ltd limited llc".split(" "));

export function companyCandidatesFromQuestion(question = "") {
  const rawTokens = String(question).match(/[A-Za-z][A-Za-z&.-]{2,}|\$?[A-Z]{1,5}/g) || [];
  return [...new Set(rawTokens.map((token) => token.replace(/^\$/, "").replace(/['’]s$/i, "")).filter((token) => {
    const normalized = normalize(token);
    return normalized && !QUERY_STOP_WORDS.has(normalized) && (token === token.toUpperCase() || token[0] === token[0].toUpperCase() || normalized.length > 3);
  }))];
}

function rankCompanyMatches(question, companies = []) {
  const candidates = companyCandidatesFromQuestion(question);
  const matches = new Map();
  for (const candidate of candidates) {
    const candidateName = normalizeCompanyName(candidate);
    const candidateCanonical = canonicalCompanyName(candidate);
    const candidateTokens = new Set(candidateCanonical.split(" ").filter(Boolean));
    for (const company of companies) {
      const name = normalizeCompanyName(company.name);
      const canonical = canonicalCompanyName(company.name);
      const nameTokens = canonical.split(" ").filter(Boolean);
      const overlap = nameTokens.filter((token) => candidateTokens.has(token)).length;
      let priority = 0;
      let score = 0;
      let matchType = "partial_token";
      if (normalize(company.ticker) === candidateName) {
        priority = 4000; score = 4000; matchType = "exact_ticker";
      } else if (name === candidateName) {
        priority = 3000; score = 3000; matchType = "exact_name";
      } else if (canonical && canonical === candidateCanonical) {
        priority = 2800; score = 2800; matchType = "canonical_name";
      } else if (overlap === candidateTokens.size && nameTokens[0] === [...candidateTokens][0]) {
        priority = 2000; score = 2000 + overlap / Math.max(nameTokens.length, 1) * 100; matchType = "strong_name";
      } else if (overlap > 0) {
        priority = 1000; score = 1000 + overlap / Math.max(candidateTokens.size, nameTokens.length, 1) * 100; matchType = "partial_token";
      }
      if (!priority) continue;
      const previous = matches.get(company.cik);
      if (!previous || score > previous.score) matches.set(company.cik, { company, priority, score, matchType });
    }
  }
  return [...matches.values()].sort((a, b) => b.priority - a.priority || b.score - a.score || a.company.name.localeCompare(b.company.name));
}

export function resolveCompanyInDirectory(question, companies = []) {
  return rankCompanyMatches(question, companies).map(({ company }) => company);
}

export async function resolveCompanyReference(question, options = {}) {
  const candidates = companyCandidatesFromQuestion(question);
  const ranked = rankCompanyMatches(question, await getCompanyDirectory(options));
  if (!ranked.length) return { status: candidates.length ? "NOT_FOUND" : "NONE", query: question, searchTerm: candidates[0] || "", candidates: [] };
  const [top, second] = ranked;
  const similarlyStrong = second && top.priority < 2800 && second.priority === top.priority && top.score - second.score <= 50;
  if (similarlyStrong) return { status: "AMBIGUOUS", query: question, searchTerm: candidates[0] || "", candidates: ranked.slice(0, 5).map(({ company }) => company) };
  return { status: "RESOLVED", query: question, searchTerm: candidates[0] || "", company: top.company, matchType: top.matchType, candidates: ranked.slice(0, 5).map(({ company }) => company) };
}

export async function getCompanyFilings(cik, { fetchImpl = fetch } = {}) {
  const normalizedCik = String(cik).padStart(10, "0");
  const response = await fetchImpl(`${SEC_SUBMISSIONS_URL}/CIK${normalizedCik}.json`, { headers: secHeaders() });
  if (!response.ok) throw new Error(`SEC submissions request failed: ${response.status}`);
  const data = await response.json();
  return { company: data.name, cik: String(data.cik || normalizedCik).padStart(10, "0"), ticker: data.tickers || [], filings: data.filings.recent };
}

export async function getFinancialFilings(cik, options = {}) {
  const data = await getCompanyFilings(cik, options);
  const filings = data.filings.form.map((form, index) => ({ form, filingDate: data.filings.filingDate[index], reportDate: data.filings.reportDate[index], accessionNumber: data.filings.accessionNumber[index], primaryDocument: data.filings.primaryDocument[index] })).filter((filing) => filing.form === "10-K" || filing.form === "10-Q");
  return { company: data.company, cik: data.cik, ticker: data.ticker, filings };
}

export async function downloadFiling(filing, { fetchImpl = fetch } = {}) {
  const { cik, accessionNumber, primaryDocument } = filing;
  const url = `${SEC_ARCHIVES_URL}/${Number(cik)}/${accessionNumber.replaceAll("-", "")}/${primaryDocument}`;
  const response = await fetchImpl(url, { headers: secHeaders() });
  if (!response.ok) throw new Error(`Filing download failed: ${response.status}`);
  return { url, html: await response.text() };
}
