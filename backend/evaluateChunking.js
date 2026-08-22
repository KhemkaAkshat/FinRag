import fs from "fs/promises";
import { BM25 } from "fast-bm25";
import { evaluationDataset } from "./evaluationDataset.js";

const TOP_K = 5;
const BASELINE_SIZE = 1200;
const BASELINE_OVERLAP = 200;
const FINANCIAL_MAX_SIZE = 1800;
const TABLE_MAX_SIZE = 2400;

function numericId(document) {
  return Number(document.id.replace("finrag-", ""));
}

function isTableLike(text) {
  const signals = [
    /\b20\d{2}\b/g,
    /\d+(?:\.\d+)?%/g,
    /\$\s?\d/g,
    /\btotal\b/gi,
    /\bnet sales\b/gi,
    /\bresearch and development\b/gi,
  ];
  return signals.filter((pattern) => pattern.test(text)).length >= 2;
}

function looksLikeContinuation(text) {
  const trimmed = text.trim();
  return /^[a-z),.;:%$\d]/.test(trimmed) || /[,;:]$/.test(trimmed);
}

function buildFinancialAwareProxy(documents) {
  const sorted = [...documents].sort((a, b) => numericId(a) - numericId(b));
  const chunks = [];
  let current = null;

  for (const document of sorted) {
    const tableLike = isTableLike(document.text);
    const maxSize = tableLike || current?.tableLike ? TABLE_MAX_SIZE : FINANCIAL_MAX_SIZE;
    const sameSection = current && current.metadata.section === document.metadata.section;
    const proposedLength = current ? current.text.length + 2 + document.text.length : document.text.length;

    if (!current || !sameSection || proposedLength > maxSize) {
      current = {
        id: `financial-${chunks.length}`,
        text: document.text,
        metadata: document.metadata,
        sourceIds: [document.id],
        tableLike,
      };
      chunks.push(current);
    } else {
      current.text += `\n\n${document.text}`;
      current.sourceIds.push(document.id);
      current.tableLike ||= tableLike;
    }
  }

  return chunks;
}

function search(index, documents, query) {
  return index.search(query, Math.min(TOP_K, documents.length))
    .map((result) => documents[result.index]);
}

function scoreResults(results, relevantIds) {
  const relevant = new Set(relevantIds);
  const retrievedRelevant = results.flatMap((result) => result.sourceIds)
    .filter((id) => relevant.has(id));
  const firstRelevantRank = results.findIndex((result) => result.sourceIds.some((id) => relevant.has(id)));

  return {
    precision: results.length ? results.filter((result) => result.sourceIds.some((id) => relevant.has(id))).length / results.length : 0,
    recall: new Set(retrievedRelevant).size / relevant.size,
    mrr: firstRelevantRank === -1 ? 0 : 1 / (firstRelevantRank + 1),
  };
}

function average(scores) {
  return {
    precision: scores.reduce((sum, score) => sum + score.precision, 0) / scores.length,
    recall: scores.reduce((sum, score) => sum + score.recall, 0) / scores.length,
    mrr: scores.reduce((sum, score) => sum + score.mrr, 0) / scores.length,
  };
}

function format(value) {
  return `${(value * 100).toFixed(1)}%`;
}

const documents = JSON.parse(await fs.readFile("data/bm25-documents.json", "utf8"));
const baseline = documents.map((document) => ({
  ...document,
  sourceIds: [document.id],
}));
const financialAware = buildFinancialAwareProxy(documents);
const baselineIndex = new BM25(baseline.map((document) => ({ content: document.text })));
const financialIndex = new BM25(financialAware.map((document) => ({ content: document.text })));

const baselineScores = [];
const financialScores = [];

for (const item of evaluationDataset) {
  const baselineResults = search(baselineIndex, baseline, item.question);
  const financialResults = search(financialIndex, financialAware, item.question);
  const baselineScore = scoreResults(baselineResults, item.relevantChunkIds);
  const financialScore = scoreResults(financialResults, item.relevantChunkIds);
  baselineScores.push(baselineScore);
  financialScores.push(financialScore);

  console.log(`${item.id}`);
  console.log(`  baseline: ${format(baselineScore.precision)} P@5 | ${format(baselineScore.recall)} R@5 | ${baselineScore.mrr.toFixed(3)} MRR`);
  console.log(`  financial-aware proxy: ${format(financialScore.precision)} P@5 | ${format(financialScore.recall)} R@5 | ${financialScore.mrr.toFixed(3)} MRR`);
}

const baselineTableChunks = baseline.filter((document) => isTableLike(document.text)).length;
const financialTableChunks = financialAware.filter((document) => document.tableLike).length;
const baselineContinuationBoundaries = baseline.filter((document) => looksLikeContinuation(document.text)).length;
const financialContinuationBoundaries = financialAware.filter((document) => looksLikeContinuation(document.text)).length;

console.log("\nOffline chunking comparison");
console.log(`Corpus: ${documents.length} existing chunks`);
console.log(`Baseline: RecursiveCharacterTextSplitter, size=${BASELINE_SIZE}, overlap=${BASELINE_OVERLAP}`);
console.log(`Financial-aware proxy: section-preserving repacking, max=${FINANCIAL_MAX_SIZE}, table max=${TABLE_MAX_SIZE}`);
console.log("Note: the proxy repacks existing chunks; it does not reconstruct the original SEC HTML or create embeddings.");
console.log(`Baseline chunks: ${baseline.length} | financial-aware proxy chunks: ${financialAware.length}`);
console.log(`Table-like chunks: ${baselineTableChunks} baseline | ${financialTableChunks} proxy`);
console.log(`Possible continuation boundaries: ${baselineContinuationBoundaries} baseline | ${financialContinuationBoundaries} proxy`);

const baselineAverage = average(baselineScores);
const financialAverage = average(financialScores);
console.log("\nLexical retrieval proxy averages");
console.log(`Baseline             ${format(baselineAverage.precision)} P@5 | ${format(baselineAverage.recall)} R@5 | ${baselineAverage.mrr.toFixed(3)} MRR`);
console.log(`Financial-aware proxy ${format(financialAverage.precision)} P@5 | ${format(financialAverage.recall)} R@5 | ${financialAverage.mrr.toFixed(3)} MRR`);
