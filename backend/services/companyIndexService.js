import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { getBM25CompanyCoverage, loadBM25Index } from "./bm25Service.js";
import { getPineconeCompanyStats } from "./ragService.js";

const STATE_PATH = path.resolve(process.env.INGESTION_STATE_PATH || path.join(process.cwd(), "data", "ingestion-state.json"));

export async function readIngestionState() {
  try { return JSON.parse(await fs.readFile(STATE_PATH, "utf8")); } catch (error) { if (error.code === "ENOENT") return {}; throw error; }
}

export async function getIndexedCompanyStatus(company, { pineconeStats = getPineconeCompanyStats } = {}) {
  await loadBM25Index();
  const bm25 = getBM25CompanyCoverage(company);
  const state = await readIngestionState();
  const companyState = state[company.cik] || null;
  let pinecone = null;
  try {
    pinecone = await pineconeStats(company);
    const namespaces = pinecone?.namespaces && typeof pinecone.namespaces === "object"
      ? Object.fromEntries(Object.entries(pinecone.namespaces).map(([namespace, stats]) => [namespace || "<default>", {
        recordCount: Number(stats?.recordCount ?? stats?.vectorCount ?? 0),
      }]))
      : {};
    console.info("[company-index] Pinecone status lookup", {
      cik: company.cik,
      ticker: company.ticker,
      filter: { cik: company.cik },
      filterSupported: pinecone?.filterSupported !== false,
      totalRecordCount: Number(pinecone?.totalRecordCount ?? pinecone?.totalVectorCount ?? 0),
      namespaces,
      defaultNamespaceRecordCount: Number(pinecone?.namespaces?.[""]?.recordCount ?? pinecone?.namespaces?.[""]?.vectorCount ?? 0),
    });
  } catch (error) {
    console.warn("[company-index] Pinecone status lookup failed", {
      cik: company.cik,
      ticker: company.ticker,
      filter: { cik: company.cik },
      error: error?.message || String(error),
    });
    pinecone = null;
  }
  const namespaceStats = pinecone?.namespaces?.[""];
  const vectorCount = Number(namespaceStats?.recordCount ?? namespaceStats?.vectorCount ?? pinecone?.totalRecordCount ?? pinecone?.totalVectorCount ?? 0);
  const hasVectors = vectorCount > 0;
  const hasBm25 = bm25.documentCount > 0;
  const hasCompleteFiling = companyState && Object.values(companyState.filings || {}).some((filing) => filing.status === "complete");
  let status = "not_indexed";
  if (companyState && Object.values(companyState.filings || {}).some((filing) => ["in_progress", "failed"].includes(filing.status))) status = companyState.status === "in_progress" ? "ingestion_in_progress" : "ingestion_failed";
  else if ((hasCompleteFiling || hasBm25) && hasBm25 && (hasVectors || !process.env.PINECONE_API_KEY)) status = "indexed";
  else if (hasBm25 || hasVectors) status = "partially_indexed";
  return { company, status, indexed: status === "indexed", bm25, pinecone: { vectorCount, available: pinecone !== null }, filings: companyState?.filings || {} };
}
