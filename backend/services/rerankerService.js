import "dotenv/config";
import { CohereClientV2 } from "cohere-ai";

const COHERE_MODEL = "rerank-v4.0-fast";
let cohereClient;

function getCohereClient() {
  if (cohereClient) return cohereClient;
  if (!process.env.COHERE_API_KEY?.trim()) return null;
  cohereClient = new CohereClientV2({ token: process.env.COHERE_API_KEY });
  return cohereClient;
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "how", "in", "is", "it", "of", "on", "or", "that", "the", "their",
  "this", "to", "was", "what", "when", "where", "which", "who", "with",
]);

function tokenize(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function documentText(document) {
  const metadata = document.metadata || {};
  return [
    document.text,
    metadata.company,
    metadata.ticker,
    metadata.filingType,
    metadata.item,
    metadata.section,
  ].filter(Boolean).join(" ");
}

function scoreDocument(query, document, documentFrequency, documentCount) {
  const queryTokens = tokenize(query);
  const text = documentText(document);
  const documentTokens = tokenize(text);
  const tokenCounts = new Map();

  for (const token of documentTokens) {
    tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
  }

  let weightedCoverage = 0;
  let weightedFrequency = 0;
  let totalWeight = 0;

  for (const token of queryTokens) {
    const idf = Math.log((documentCount + 1) / ((documentFrequency.get(token) || 0) + 1)) + 1;
    totalWeight += idf;
    if (tokenCounts.has(token)) {
      weightedCoverage += idf;
      weightedFrequency += idf * Math.min(tokenCounts.get(token) / 3, 1);
    }
  }

  const coverage = totalWeight ? weightedCoverage / totalWeight : 0;
  const frequency = totalWeight ? weightedFrequency / totalWeight : 0;
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedText = text.toLowerCase();
  const phraseBonus = normalizedQuery.length > 3 && normalizedText.includes(normalizedQuery) ? 0.15 : 0;
  const metadataTokens = tokenize([document.metadata?.company, document.metadata?.ticker, document.metadata?.section].filter(Boolean).join(" "));
  const metadataMatches = queryTokens.filter((token) => metadataTokens.includes(token)).length;
  const metadataBonus = queryTokens.length ? Math.min(metadataMatches / queryTokens.length, 1) * 0.1 : 0;

  return coverage * 0.55 + frequency * 0.2 + phraseBonus + metadataBonus;
}

export function rerankLocal(query, documents = [], topK = 5) {
  const documentTokens = documents.map((document) => new Set(tokenize(documentText(document))));
  const documentFrequency = new Map();

  for (const tokens of documentTokens) {
    for (const token of tokens) documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
  }

  return documents
    .map((document, index) => ({
      ...document,
      rerankScore: scoreDocument(query, document, documentFrequency, documents.length),
      _originalRank: index,
    }))
    .sort((a, b) => b.rerankScore - a.rerankScore || a._originalRank - b._originalRank)
    .slice(0, topK)
    .map(({ _originalRank, ...document }) => document);
}

function cohereDocumentText(document) {
  const metadata = document.metadata || {};
  return [
    document.text,
    metadata.company && `Company: ${metadata.company}`,
    metadata.ticker && `Ticker: ${metadata.ticker}`,
    metadata.filingType && `Filing: ${metadata.filingType}`,
    metadata.item && `Item: ${metadata.item}`,
    metadata.section && `Section: ${metadata.section}`,
  ].filter(Boolean).join("\n");
}

export async function rerankWithCohere(query, documents = [], topK = 5, client = getCohereClient()) {
  if (!client) {
    throw new Error("COHERE_API_KEY is not configured.");
  }

  if (documents.length === 0) return [];

  const response = await client.rerank({
    model: COHERE_MODEL,
    query,
    documents: documents.map(cohereDocumentText),
    topN: topK,
  });

  return (response.results || []).map((result) => ({
    ...documents[result.index],
    cohereScore: result.relevanceScore,
  }));
}

export async function rerank(query, documents = [], topK = 5) {
  if (!getCohereClient()) return rerankLocal(query, documents, topK);

  try {
    return await rerankWithCohere(query, documents, topK);
  } catch (error) {
    console.warn("Cohere reranking failed; using local reranker fallback.", error.message);
    return rerankLocal(query, documents, topK);
  }
}
