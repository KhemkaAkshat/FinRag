import "dotenv/config";

import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { GoogleGenAI } from "@google/genai";
import { Pinecone } from "@pinecone-database/pinecone";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const EMBEDDING_MODEL = "gemini-embedding-001";

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1200,
  chunkOverlap: 200,
});

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const index = pinecone.index(process.env.PINECONE_INDEX_NAME);

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
  const response = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: texts,
    config: {
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: 3072,
    },
  });

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

    const result = await index.fetch({
      ids: batch,
    });

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
    id: `finrag-${index}`,
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
          sourceUrl: document.metadata.sourceUrl,
          item: document.metadata.item,
          section: document.metadata.section,
          text: document.pageContent,
        },
      };
    });

    console.log("Uploading to Pinecone...");

    await index.upsert({
      records: pineconeRecords,
    });

    uploaded += batch.length;

    console.log(`Uploaded: ${uploaded}/${documents.length}`);
  }

  console.log("\nIngestion complete.");

  const stats = await index.describeIndexStats();

  console.log("Pinecone stats:", stats);

  return uploaded;
}


