import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { extractSections, extractTextFromHtml } from "./documentService.js";
import { findCompany, getFinancialFilings, downloadFiling } from "./secService.js";
import { createRagDocuments, storeDocuments } from "./ragService.js";
import { appendBM25Index } from "./bm25Service.js";
import { filingKey, stableDocumentId } from "./documentIdentity.js";

const statePath = path.resolve(process.env.INGESTION_STATE_PATH || path.join(process.cwd(), "data", "ingestion-state.json"));
const stagingRoot = path.resolve(process.env.INGESTION_STAGING_PATH || path.join(process.cwd(), "data", "ingestion-staging"));

async function readJson(filePath, fallback) {
  try { return JSON.parse(await fs.readFile(filePath, "utf8")); } catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tempPath, filePath);
}

function stagedPath(company, filing) { return path.join(stagingRoot, company.cik, `${filing.form}-${filing.accessionNumber}.json`); }

function selectLatestFilings(filings, forms) {
  return forms.map((form) => filings.find((filing) => filing.form === form)).filter(Boolean);
}

export async function ingestCompany({ searchTerm, company: suppliedCompany, forms = ["10-K", "10-Q"], dependencies = {}, paths = {}, onProgress = () => {} }) {
  const currentStatePath = paths.statePath || statePath;
  const currentStagingRoot = paths.stagingRoot || stagingRoot;
  const resolve = dependencies.findCompany || findCompany;
  const matches = suppliedCompany ? [suppliedCompany] : await resolve(searchTerm);
  if (matches.length === 0) throw new Error(`No SEC company matched "${searchTerm}".`);
  if (matches.length > 1 && !matches.some((match) => match.ticker.toLowerCase() === String(searchTerm).toLowerCase())) throw new Error(`Company search is ambiguous: ${matches.slice(0, 5).map((match) => `${match.name} (${match.ticker})`).join(", ")}`);
  const company = suppliedCompany || matches.find((match) => match.ticker.toLowerCase() === String(searchTerm).toLowerCase()) || matches[0];
  onProgress({ status: "QUEUED", company });
  const lockPath = `${currentStatePath}.${company.cik}.lock`;
  let lockHandle;
  try {
    lockHandle = await fs.open(lockPath, "wx");
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`An ingestion job is already running for ${company.name}.`);
    throw error;
  }
  const getFilings = dependencies.getFinancialFilings || getFinancialFilings;
  const download = dependencies.downloadFiling || downloadFiling;
  const createDocuments = dependencies.createRagDocuments || createRagDocuments;
  const store = dependencies.storeDocuments || storeDocuments;
  const appendBM25 = dependencies.appendBM25Index || appendBM25Index;
  const extractText = dependencies.extractTextFromHtml || extractTextFromHtml;
  const extractSectionList = dependencies.extractSections || extractSections;
  const state = await readJson(currentStatePath, {});
  const companyState = state[company.cik] || { company, status: "in_progress", filings: {} };
  companyState.status = "in_progress";
  state[company.cik] = companyState;
  await writeJsonAtomic(currentStatePath, state);

  try {
    const financialData = await getFilings(company.cik);
    const selectedFilings = selectLatestFilings(financialData.filings, forms);
    for (const filing of selectedFilings) {
      const key = filingKey(filing);
      const existing = companyState.filings[key];
      if (existing?.status === "complete") continue;
      const stageFile = path.join(currentStagingRoot, company.cik, `${filing.form}-${filing.accessionNumber}.json`);
      let documents = await readJson(stageFile, null);
      if (!documents) {
        onProgress({ status: "DOWNLOADING", company, filing });
        const downloaded = await download({ cik: company.cik, ...filing });
        const sections = extractSectionList(extractText(downloaded.html));
        const ragDocuments = await createDocuments(sections, { company: financialData.company, ticker: financialData.ticker[0] || company.ticker, cik: company.cik, filingType: filing.form, filingDate: filing.filingDate, reportDate: filing.reportDate, accessionNumber: filing.accessionNumber, primaryDocument: filing.primaryDocument, sourceUrl: downloaded.url });
        documents = ragDocuments.map((document, index) => ({ id: stableDocumentId({ cik: company.cik, accessionNumber: filing.accessionNumber, chunkIndex: index }), pageContent: document.pageContent, metadata: { ...document.metadata, documentId: stableDocumentId({ cik: company.cik, accessionNumber: filing.accessionNumber, chunkIndex: index }) } }));
        await writeJsonAtomic(stageFile, documents);
      }
      companyState.filings[key] = { ...filing, status: "pinecone_in_progress", totalChunks: documents.length, completedChunks: 0, updatedAt: new Date().toISOString() };
      onProgress({ status: "INDEXING", company, filing, totalChunks: documents.length, completedChunks: 0 });
      await writeJsonAtomic(currentStatePath, state);
      await store(documents);
      companyState.filings[key] = { ...companyState.filings[key], status: "bm25_in_progress", completedChunks: documents.length, updatedAt: new Date().toISOString() };
      onProgress({ status: "UPDATING_BM25", company, filing, totalChunks: documents.length, completedChunks: documents.length });
      await writeJsonAtomic(currentStatePath, state);
      await appendBM25(documents);
      companyState.filings[key] = { ...companyState.filings[key], status: "complete", updatedAt: new Date().toISOString() };
      await writeJsonAtomic(currentStatePath, state);
    }
    companyState.status = "complete";
    await writeJsonAtomic(currentStatePath, state);
    onProgress({ status: "READY", company, filings: companyState.filings });
    return { company, status: companyState.status, filings: companyState.filings };
  } catch (error) {
    companyState.status = "failed";
    companyState.error = error.message;
    companyState.updatedAt = new Date().toISOString();
    await writeJsonAtomic(currentStatePath, state);
    throw error;
  } finally {
    await lockHandle.close();
    await fs.rm(lockPath, { force: true });
  }
}
