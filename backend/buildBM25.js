import "dotenv/config";

import {
  extractTextFromHtml,
  extractSections,
} from "./services/documentService.js";

import {
  findCompany,
  getFinancialFilings,
  downloadFiling,
} from "./services/secService.js";

import {
  createRagDocuments,
} from "./services/ragService.js";

import {
  buildBM25Index,
} from "./services/bm25Service.js";

async function main() {
  console.log("\n==============================");
  console.log("BM25 INDEX BUILD");
  console.log("==============================");

  const financialData =
    await getFinancialFilings("0000320193");

  const latest10K =
    financialData.filings.find(
      (filing) => filing.form === "10-K"
    );

  if (!latest10K) {
    throw new Error("No 10-K filing found.");
  }

  console.log("\nSelected filing:");
  console.log(latest10K);

  const filing =
    await downloadFiling({
      cik: financialData.cik,
      ...latest10K,
    });

  console.log("\nFiling downloaded.");

  const cleanText =
    extractTextFromHtml(filing.html);

  const sections =
    extractSections(cleanText);

  const documents =
    await createRagDocuments(
      sections,
      {
        company: financialData.company,
        ticker: financialData.ticker[0],
        cik: financialData.cik,
        filingType: latest10K.form,
        filingDate: latest10K.filingDate,
        reportDate: latest10K.reportDate,
        sourceUrl: filing.url,
      }
    );

  console.log(
    "\nDocuments created:",
    documents.length
  );

  await buildBM25Index(documents);

  console.log("\nBM25 index created successfully.");
}

main().catch((error) => {
  console.error("\nBM25 build failed:");
  console.error(error);
  process.exit(1);
});