import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { BM25 } from "fast-bm25";
import { matchesMetadata } from "./retrievalService.js";

const INDEX_PATH = path.resolve(process.cwd(), "data", "bm25-documents.json");
let bm25 = null;
let documents = [];
let loadPromise = null;

function normalizeDocuments(ragDocuments) {
  return ragDocuments.map((document, index) => ({ id: document.id || document.metadata?.documentId || `finrag-${index}`, text: document.pageContent ?? document.text, metadata: document.metadata || {} }));
}

async function writeDocuments(nextDocuments) {
  await fs.mkdir(path.dirname(INDEX_PATH), { recursive: true });
  const tempPath = `${INDEX_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(nextDocuments, null, 2), "utf-8");
  await fs.rename(tempPath, INDEX_PATH);
  documents = nextDocuments;
  bm25 = new BM25(documents.map((document) => ({ content: document.text })));
  loadPromise = Promise.resolve(true);
}

export async function buildBM25Index(ragDocuments) {
  const nextDocuments = normalizeDocuments(ragDocuments);
  await writeDocuments(nextDocuments);
  console.log(`BM25 index built with ${documents.length} documents.`);
  return documents.length;
}

export async function appendBM25Index(ragDocuments) {
  await loadBM25Index();
  const incoming = normalizeDocuments(ragDocuments);
  const byId = new Map(documents.map((document) => [document.id, document]));
  for (const document of incoming) byId.set(document.id, document);
  await writeDocuments([...byId.values()]);
  console.log(`BM25 index now contains ${documents.length} documents.`);
  return documents.length;
}

export async function loadBM25Index({ force = false } = {}) {
  if (bm25 && !force) return true;
  if (loadPromise && !force) return loadPromise;
  loadPromise = (async () => {
    try {
      const raw = await fs.readFile(INDEX_PATH, "utf-8");
      documents = JSON.parse(raw);
      bm25 = new BM25(documents.map((document) => ({ content: document.text })));
      console.log(`BM25 index loaded with ${documents.length} documents.`);
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  })();
  return loadPromise;
}

export function searchBM25(query, topK = 5, filters = {}) {
  if (!bm25) throw new Error("BM25 index has not been initialized.");
  const searchLimit = Object.keys(filters).length ? documents.length : topK;
  const results = bm25.search(query, searchLimit);
  return results.filter((result) => matchesMetadata(documents[result.index].metadata, filters)).slice(0, topK).map((result) => ({ id: documents[result.index].id, bm25Score: result.score, metadata: documents[result.index].metadata, text: documents[result.index].text }));
}

export function getBM25DocumentCount() { return documents.length; }
export function getBM25Documents() { return documents.map((document) => ({ ...document, metadata: { ...document.metadata } })); }
export function getBM25CompanyCoverage(company) {
  const matches = documents.filter((document) => (company.cik && String(document.metadata?.cik) === String(company.cik)) || (company.ticker && String(document.metadata?.ticker).toUpperCase() === String(company.ticker).toUpperCase()));
  return { documentCount: matches.length, filings: [...new Set(matches.map((document) => `${document.metadata?.filingType}:${document.metadata?.accessionNumber || document.metadata?.filingDate || "legacy"}`))] };
}
