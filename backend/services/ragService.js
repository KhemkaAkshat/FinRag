import "dotenv/config";

import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { GoogleGenAI } from "@google/genai";
import { Pinecone } from "@pinecone-database/pinecone";
import { searchBM25, loadBM25Index } from "./bm25Service.js";
import { buildMetadataFilter, reciprocalRankFusion } from "./retrievalService.js";
import { getOperationalSettings } from "../config.js";
import { UpstreamServiceError, withRetry } from "./resilienceService.js";

const EMBEDDING_MODEL = "gemini-embedding-001";
const PINECONE_CANDIDATE_COUNT = 10;
const BM25_CANDIDATE_COUNT = 20;
const settings = getOperationalSettings();

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1200,
  chunkOverlap: 200,
});

let ai;
let index;

function getGeminiClient() {
  if (ai) return ai;
  if (!process.env.GEMINI_API_KEY?.trim()) {
    throw new UpstreamServiceError("Gemini credentials are not configured.", { code: "CONFIGURATION_ERROR", statusCode: 503 });
  }
  ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return ai;
}

function getPineconeIndex() {
  if (index) return index;
  if (!process.env.PINECONE_API_KEY?.trim() || !process.env.PINECONE_INDEX_NAME?.trim()) {
    throw new UpstreamServiceError("Pinecone credentials are not configured.", { code: "CONFIGURATION_ERROR", statusCode: 503 });
  }
  const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  index = pinecone.index(process.env.PINECONE_INDEX_NAME);
  return index;
}

function pineconeRequest(label, operation) {
  return withRetry(operation, {
    label: `Pinecone ${label}`,
    timeoutMs: settings.requestTimeoutMs,
    maxAttempts: settings.retryMaxAttempts,
    baseDelayMs: settings.retryBaseDelayMs,
  });
}

export async function createRagDocuments(sections, metadata) {
  const documents = [];

  for (const section of sections) {
    const sectionDocuments = await splitter.createDocuments(
      [section.text],
      [
        {
          ...metadata,
          item: section.item,
          section: section.title || `Item ${section.item}`,
        },
      ],
    );

    documents.push(...sectionDocuments);
  }

  return documents;
}

async function generateEmbeddings(texts) {
  const response = await withRetry(
    () => getGeminiClient().models.embedContent({
      model: EMBEDDING_MODEL,
      contents: texts,
      config: { taskType: "RETRIEVAL_DOCUMENT", outputDimensionality: 3072 },
    }),
    { label: "Gemini document embeddings", timeoutMs: settings.requestTimeoutMs, maxAttempts: settings.retryMaxAttempts, baseDelayMs: settings.retryBaseDelayMs },
  );

  if (!response.embeddings || response.embeddings.length === 0) {
    throw new Error("Gemini returned no embeddings.");
  }

  return response.embeddings.map((embedding) => embedding.values);
}

async function getExistingRecordIds(ids) {
  const existingIds = new Set();
  const batchSize = 100;

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);

    if (batch.length === 0) {
      continue;
    }

    const result = await pineconeRequest("fetch", () => getPineconeIndex().fetch({ ids: batch }));

    for (const id of Object.keys(result.records || {})) {
      existingIds.add(id);
    }
  }

  return existingIds;
}

export async function storeDocuments(documents) {
  console.log("\nPINECONE INGESTION");
  console.log("==============================");
  console.log("Documents:", documents.length);

  const recordsToCreate = documents.map((document, index) => ({
    id: document.metadata?.documentId || document.id || `finrag-${index}`,
    document,
  }));

  const allIds = recordsToCreate.map((record) => record.id);

  const existingIds = await getExistingRecordIds(allIds);

  console.log("Already stored:", existingIds.size);

  const pendingRecords = recordsToCreate.filter(
    (record) => !existingIds.has(record.id),
  );

  console.log("Remaining to embed:", pendingRecords.length);

  if (pendingRecords.length === 0) {
    console.log("All documents are already stored.");

    return documents.length;
  }

  const embeddingBatchSize = 50;
  let uploaded = existingIds.size;

  for (let i = 0; i < pendingRecords.length; i += embeddingBatchSize) {
    const batch = pendingRecords.slice(i, i + embeddingBatchSize);

    console.log(
      `\nProcessing ${i + 1}-${Math.min(
        i + batch.length,
        pendingRecords.length,
      )}/${pendingRecords.length}`,
    );

    const texts = batch.map((record) => record.document.pageContent);

    console.log("Generating embeddings...");

    const vectors = await generateEmbeddings(texts);

    console.log("Embeddings received:", vectors.length);

    if (vectors.length !== batch.length) {
      throw new Error(
        `Embedding count mismatch. Expected ${batch.length}, received ${vectors.length}`,
      );
    }

    for (let i = 0; i < vectors.length; i++) {
      if (!Array.isArray(vectors[i])) {
        throw new Error(`Embedding ${i} is not an array.`);
      }

      if (vectors[i].length !== 3072) {
        throw new Error(
          `Invalid embedding dimension at index ${i}: ${vectors[i].length}. Expected 3072.`,
        );
      }
    }

    const pineconeRecords = batch.map((record, vectorIndex) => {
      const document = record.document;

      return {
        id: record.id,
        values: vectors[vectorIndex],
        metadata: {
          company: document.metadata.company,
          ticker: document.metadata.ticker,
          cik: document.metadata.cik,
          filingType: document.metadata.filingType,
          filingDate: document.metadata.filingDate,
          reportDate: document.metadata.reportDate,
          accessionNumber: document.metadata.accessionNumber,
          primaryDocument: document.metadata.primaryDocument,
          sourceUrl: document.metadata.sourceUrl,
          item: document.metadata.item,
          section: document.metadata.section,
          text: document.pageContent,
        },
      };
    });

    console.log("Uploading to Pinecone...");

    await pineconeRequest("upsert", () => getPineconeIndex().upsert({ records: pineconeRecords }));

    uploaded += batch.length;

    console.log(`Uploaded: ${uploaded}/${documents.length}`);
  }

  console.log("\nIngestion complete.");

  const stats = await pineconeRequest("describe index", () => getPineconeIndex().describeIndexStats());

  console.log("Pinecone stats:", stats);

  return uploaded;
}

export async function getPineconeCompanyStats(company) {
  const filter = company?.cik ? { cik: company.cik } : company?.ticker ? { ticker: company.ticker } : {};
  if (!Object.keys(filter).length) return null;
  try {
    return await pineconeRequest("company stats", () => getPineconeIndex().describeIndexStats({ filter }));
  } catch (error) {
    const filteredStatsUnsupported = /do not support describing index stats with metadata filtering/i.test(String(error?.cause?.message || error?.message || ""));
    if (filteredStatsUnsupported) {
      console.warn("[pinecone] filtered company stats unsupported; using unfiltered index stats", {
        indexName: process.env.PINECONE_INDEX_NAME || "<missing>",
        filter,
      });
      const stats = await pineconeRequest("index stats", () => getPineconeIndex().describeIndexStats());
      return { ...stats, filterSupported: false };
    }
    console.error("[pinecone] company stats diagnostic", {
      indexName: process.env.PINECONE_INDEX_NAME || "<missing>",
      filter,
      error: {
        name: error?.name,
        message: error?.message,
        code: error?.code,
        status: error?.status || error?.statusCode,
      },
      cause: error?.cause ? {
        name: error.cause.name,
        message: error.cause.message,
        code: error.cause.code,
        status: error.cause.status || error.cause.statusCode,
      } : undefined,
    });
    throw error;
  }
}
export async function generateQueryEmbedding(query) {
  const response = await withRetry(
    () => getGeminiClient().models.embedContent({
      model: EMBEDDING_MODEL,
      contents: [query],
      config: { taskType: "RETRIEVAL_QUERY", outputDimensionality: 3072 },
    }),
    { label: "Gemini query embedding", timeoutMs: settings.requestTimeoutMs, maxAttempts: settings.retryMaxAttempts, baseDelayMs: settings.retryBaseDelayMs },
  );

  if (
    !response.embeddings ||
    response.embeddings.length === 0
  ) {
    throw new Error(
      "Gemini returned no query embedding."
    );
  }

  return response.embeddings[0].values;
}

export async function searchDocuments(
  query,
  topK = 5,
  filters = {}
) {
  const queryVector =
    await generateQueryEmbedding(query);

  const queryOptions = {
      vector: queryVector,
      topK: PINECONE_CANDIDATE_COUNT,
      includeMetadata: true,
  };
  const metadataFilter = buildMetadataFilter(filters);
  if (Object.keys(metadataFilter).length > 0) queryOptions.filter = metadataFilter;

  const vectorResults = await pineconeRequest("query", () => getPineconeIndex().query(queryOptions));

  const pineconeMatches =
    vectorResults.matches || [];

  const bm25Ready =
    await loadBM25Index();

  if (!bm25Ready) {
    throw new Error(
      "BM25 index has not been built."
    );
  }

  const bm25Matches = searchBM25(query, BM25_CANDIDATE_COUNT, metadataFilter);

  console.log(
    "\nPinecone results:",
    pineconeMatches.length
  );

  console.log(
    "BM25 results:",
    bm25Matches.length
  );

  const hybridResults = reciprocalRankFusion(
    pineconeMatches,
    bm25Matches,
    topK,
  );

  console.log(
    "RRF results:",
    hybridResults.length
  );

  return hybridResults;
}

