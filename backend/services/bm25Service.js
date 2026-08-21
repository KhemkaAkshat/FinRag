import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { BM25 } from "fast-bm25";
import { matchesMetadata } from "./retrievalService.js";

const INDEX_PATH = path.resolve(
  process.cwd(),
  "data",
  "bm25-documents.json"
);

let bm25 = null;
let documents = [];
let loadPromise = null;

export async function buildBM25Index(ragDocuments) {
  documents = ragDocuments.map((document, index) => ({
    id: `finrag-${index}`,
    text: document.pageContent,
    metadata: document.metadata,
  }));

  bm25 = new BM25(
    documents.map((document) => ({
      content: document.text,
    }))
  );

  await fs.mkdir(
    path.dirname(INDEX_PATH),
    { recursive: true }
  );

  await fs.writeFile(
    INDEX_PATH,
    JSON.stringify(documents, null, 2),
    "utf-8"
  );

  console.log(
    `BM25 index built with ${documents.length} documents.`
  );

  return documents.length;
}

export async function loadBM25Index() {
  if (bm25) {
    return true;
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    try {
      const raw = await fs.readFile(INDEX_PATH, "utf-8");

      documents = JSON.parse(raw);

      bm25 = new BM25(
        documents.map((document) => ({ content: document.text }))
      );

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
  if (!bm25) {
    throw new Error(
      "BM25 index has not been initialized."
    );
  }

  const searchLimit = Object.keys(filters).length ? documents.length : topK;
  const results = bm25.search(query, searchLimit);

  return results.filter((result) => matchesMetadata(documents[result.index].metadata, filters)).slice(0, topK).map((result) => {
    const document = documents[result.index];

    return {
      id: document.id,
      bm25Score: result.score,
      metadata: document.metadata,
      text: document.text,
    };
  });
}

export function getBM25DocumentCount() {
  return documents.length;
}
