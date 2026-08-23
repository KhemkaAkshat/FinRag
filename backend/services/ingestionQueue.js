import { randomUUID } from "node:crypto";
import { ingestCompany as defaultIngestCompany } from "./ingestionService.js";
import { clearAnswerCache } from "./chatService.js";
import { getIndexedCompanyStatus } from "./companyIndexService.js";

const jobs = new Map();
const pending = [];
let running = false;

function publicJob(job) {
  return { id: job.id, cik: job.cik, company: job.company, forms: job.forms, status: job.status, progress: job.progress || null, error: job.error || null, createdAt: job.createdAt, updatedAt: job.updatedAt };
}

function update(job, patch) { Object.assign(job, patch, { updatedAt: new Date().toISOString() }); }

async function runNext() {
  if (running || pending.length === 0) return;
  running = true;
  const job = pending.shift();
  update(job, { status: "RUNNING" });
  try {
    await job.ingest({ company: job.company, searchTerm: job.cik, forms: job.forms, onProgress: (progress) => update(job, { status: progress.status, progress }) });
    clearAnswerCache();
    update(job, { status: "READY", progress: { status: "READY" } });
  } catch (error) {
    update(job, { status: "FAILED", error: error.message });
  } finally {
    running = false;
    void runNext();
  }
}

export async function requestIngestion({ company, forms = ["10-K", "10-Q"], ingest = defaultIngestCompany, getStatus = getIndexedCompanyStatus } = {}) {
  const activeStatuses = ["QUEUED", "RUNNING", "DOWNLOADING", "INDEXING", "UPDATING_BM25"];
  const existing = [...jobs.values()].find((job) => job.cik === company.cik && activeStatuses.includes(job.status));
  if (existing) return { job: publicJob(existing), duplicate: true };
  const indexed = await getStatus(company);
  if (indexed.indexed) return { job: { cik: company.cik, company, forms, status: "READY", progress: { status: "READY" } }, duplicate: true };
  const job = { id: randomUUID(), cik: company.cik, company, forms, status: "QUEUED", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ingest };
  jobs.set(job.id, job);
  pending.push(job);
  void runNext();
  return { job: publicJob(job), duplicate: false };
}

export async function getIngestionStatus(cik, { company } = {}) {
  const normalizedCik = String(cik).padStart(10, "0");
  const active = [...jobs.values()].reverse().find((job) => job.cik === normalizedCik);
  if (active) return publicJob(active);
  if (company) {
    const indexed = await getIndexedCompanyStatus(company);
    return { cik: company.cik, company, status: indexed.indexed ? "READY" : "NOT_REQUESTED", progress: null };
  }
  return { cik: normalizedCik, status: "NOT_REQUESTED", progress: null };
}

export function resetIngestionQueueForTests() { jobs.clear(); pending.length = 0; running = false; }
