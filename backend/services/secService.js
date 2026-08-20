import {
  extractTextFromHtml,
  extractSections,
  inspectFilingStructure
} from "./documentService.js";
import "dotenv/config";
import { createRagDocuments, embedDocument } from "./ragService.js";

const SEC_COMPANY_URL =
  "https://www.sec.gov/files/company_tickers.json";

export async function findCompany(searchTerm) {
  const response = await fetch(SEC_COMPANY_URL, {
    headers: {
      "User-Agent": "FinRAG your-email@example.com"
    }
  });

  if (!response.ok) {
    throw new Error(`SEC request failed: ${response.status}`);
  }

  const companies = await response.json();

  const search = searchTerm.toLowerCase().trim();

  const allCompanies = Object.values(companies).map((company) => ({
    cik: String(company.cik_str).padStart(10, "0"),
    ticker: company.ticker,
    name: company.title
  }));

  // 1. Exact ticker match
  const exactTickerMatches = allCompanies.filter(
    (company) => company.ticker.toLowerCase() === search
  );

  if (exactTickerMatches.length > 0) {
    return exactTickerMatches;
  }

  // 2. Exact company name match
  const exactNameMatches = allCompanies.filter(
    (company) => company.name.toLowerCase() === search
  );

  if (exactNameMatches.length > 0) {
    return exactNameMatches;
  }

  // 3. Word-based company-name match
  const wordMatches = allCompanies.filter((company) => {
    const name = company.name.toLowerCase();

    const words = name
      .replace(/[.,()]/g, "")
      .split(/\s+/);

    return words.includes(search);
  });

  return wordMatches;
}

const SEC_SUBMISSIONS_URL =
  "https://data.sec.gov/submissions";

export async function getCompanyFilings(cik) {
  const response = await fetch(
    `${SEC_SUBMISSIONS_URL}/CIK${cik}.json`,
    {
      headers: {
        "User-Agent": "FinRAG your-email@example.com"
      }
    }
  );

  if (!response.ok) {
    throw new Error(`SEC submissions request failed: ${response.status}`);
  }

  const data = await response.json();

  return {
    company: data.name,
    cik: data.cik,
    ticker: data.tickers,
    filings: data.filings.recent
  };
}

export async function getFinancialFilings(cik) {
  const data = await getCompanyFilings(cik);

  const financialFilings = data.filings.form
    .map((form, index) => ({
      form,
      filingDate: data.filings.filingDate[index],
      reportDate: data.filings.reportDate[index],
      accessionNumber: data.filings.accessionNumber[index],
      primaryDocument: data.filings.primaryDocument[index]
    }))
    .filter((filing) => {
      return filing.form === "10-K" || filing.form === "10-Q";
    });

  return {
    company: data.company,
    cik: data.cik,
    ticker: data.ticker,
    filings: financialFilings
  };
}

const SEC_ARCHIVES_URL =
  "https://www.sec.gov/Archives/edgar/data";

export async function downloadFiling(filing) {
  const { cik, accessionNumber, primaryDocument } = filing;

  // SEC archive uses accession number without dashes
  const accessionWithoutDashes = accessionNumber.replaceAll("-", "");

  const url =
    `${SEC_ARCHIVES_URL}/` +
    `${Number(cik)}/` +
    `${accessionWithoutDashes}/` +
    `${primaryDocument}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "FinRAG your-email@example.com"
    }
  });

  if (!response.ok) {
    throw new Error(
      `Filing download failed: ${response.status}`
    );
  }

  const html = await response.text();

  return {
    url,
    html
  };
}

const financialData = await getFinancialFilings("0000320193");

const latest10K = financialData.filings.find(
  (filing) => filing.form === "10-K"
);

console.log("Selected filing:");
console.log(latest10K);

const filing = await downloadFiling({
  cik: financialData.cik,
  ...latest10K
});

console.log("Filing URL:");
console.log(filing.url);

inspectFilingStructure(filing.html);

const cleanText = extractTextFromHtml(filing.html);

const sections = extractSections(cleanText);
const documents = await createRagDocuments(
  sections,
  {
    company: financialData.company,
    ticker: financialData.ticker[0],
    cik: financialData.cik,
    filingType: latest10K.form,
    filingDate: latest10K.filingDate,
    reportDate: latest10K.reportDate,
    sourceUrl: filing.url
  }
);

console.log("\n==============================");
console.log("EMBEDDING TEST");
console.log("==============================");

const vector = await embedDocument(documents[0]);

console.log("Vector length:", vector.length);
console.log("First 10 values:", vector.slice(0, 10));