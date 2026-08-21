import { loadBM25Index, searchBM25 } from "./services/bm25Service.js";
import { reciprocalRankFusion } from "./services/retrievalService.js";

const questions = [
  "What products and services does Apple sell?",
  "What are the company's main business risks?",
  "How did net sales change during the reporting period?",
  "What are the company's research and development expenses?",
];

await loadBM25Index();

for (const question of questions) {
  const bm25Results = searchBM25(question, 10);
  // Offline evaluation deliberately uses a deterministic alternate ranking
  // as the Pinecone candidate set, so this script never creates embeddings.
  const pineconeResults = [...bm25Results].reverse().map((result, index) => ({
    ...result,
    score: 1 - index / 100,
  }));
  const hybridResults = reciprocalRankFusion(pineconeResults, bm25Results, 5);

  console.log(`\n${question}`);
  console.log("Pinecone-only:", pineconeResults.slice(0, 5).map((result) => result.id).join(", ") || "none");
  console.log("BM25-only:    ", bm25Results.slice(0, 5).map((result) => result.id).join(", ") || "none");
  console.log("Hybrid RRF:   ", hybridResults.map((result) => result.id).join(", ") || "none");
}

