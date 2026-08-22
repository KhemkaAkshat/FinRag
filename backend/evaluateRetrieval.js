import { loadBM25Index, searchBM25, getBM25DocumentCount } from "./services/bm25Service.js";
import { matchesMetadata, reciprocalRankFusion } from "./services/retrievalService.js";
import { rerankLocal, rerankWithCohere } from "./services/rerankerService.js";
import { evaluationDataset } from "./evaluationDataset.js";
import fs from "fs/promises";

const TOP_K = 5;
const LIVE_FIXTURE_PATH = "evaluation/live-pinecone-results.json";
const useLocal = process.argv.includes("--local");
const useCohere = process.argv.includes("--cohere");
const debugReranker = process.argv.includes("--debug-reranker");

function metrics(results, relevantChunkIds) {
  const relevant = new Set(relevantChunkIds);
  const retrieved = results.slice(0, TOP_K).map((result) => result.id);
  const relevantRetrieved = retrieved.filter((id) => relevant.has(id)).length;
  const firstRelevantRank = retrieved.findIndex((id) => relevant.has(id));

  return {
    precision: relevantRetrieved / TOP_K,
    recall: relevantRetrieved / relevant.size,
    mrr: firstRelevantRank === -1 ? 0 : 1 / (firstRelevantRank + 1),
    ids: retrieved,
  };
}

function mockPineconeCandidates(bm25Results) {
  // Existing offline candidate strategy: deterministic precomputed-style
  // candidates, with no embedding generation or Pinecone request.
  return [...bm25Results].reverse().map((result, index) => ({
    ...result,
    score: 1 - index / 100,
  }));
}

async function loadLivePineconeCandidates() {
  try {
    const fixture = JSON.parse(await fs.readFile(LIVE_FIXTURE_PATH, "utf8"));
    return fixture.questions || {};
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function formatMetric(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function printTable(averages) {
  const rows = [
    ["Method", "Precision@5", "Recall@5", "MRR"],
    ...Object.entries(averages).map(([method, values]) => [
      method,
      formatMetric(values.precision),
      formatMetric(values.recall),
      values.mrr.toFixed(3),
    ]),
  ];
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));

  console.log("\nOverall averages");
  console.log(rows.map((row) => row.map((value, column) => value.padEnd(widths[column])).join("  ")).join("\n"));
}

const storedDocuments = JSON.parse(await fs.readFile("data/bm25-documents.json", "utf8"));
const storedIds = new Set(storedDocuments.map((document) => document.id));
const documentsById = new Map(storedDocuments.map((document) => [document.id, document]));
const invalidLabels = evaluationDataset.flatMap((item) => item.relevantChunkIds.filter((id) => !storedIds.has(id)));

if (invalidLabels.length > 0 || storedIds.size !== 208) {
  throw new Error(`Evaluation dataset expects 208 stored chunks and valid labels. Found ${storedIds.size} chunks; invalid labels: ${invalidLabels.join(", ") || "none"}.`);
}

await loadBM25Index();
const livePineconeCandidates = await loadLivePineconeCandidates();
console.log(`Pinecone candidates: ${livePineconeCandidates ? "live fixture" : "offline mock fallback"}`);
if (debugReranker && useCohere) {
  throw new Error("--debug-reranker cannot be combined with --cohere; debug mode never calls Cohere.");
}
if (debugReranker && !livePineconeCandidates) {
  throw new Error("--debug-reranker requires evaluation/live-pinecone-results.json.");
}
if (useCohere && !livePineconeCandidates) {
  throw new Error("--cohere requires evaluation/live-pinecone-results.json. Run collect:live-retrieval first.");
}
if (useCohere && !process.env.COHERE_API_KEY) {
  throw new Error("--cohere requires COHERE_API_KEY in backend/.env.");
}
if (useCohere) {
  console.warn("WARNING: --cohere makes 8 Cohere reranking requests. Gemini, embeddings, and Pinecone are still not called.");
}

const methodNames = ["Pinecone", "BM25", "RRF", ...(useLocal ? ["RRF + local"] : []), ...(useCohere ? ["RRF + Cohere"] : [])];
const totals = Object.fromEntries(methodNames.map((method) => [method, { precision: 0, recall: 0, mrr: 0 }]));

console.log("FinRAG offline retrieval evaluation");
console.log(`Dataset: ${evaluationDataset.length} labeled questions / ${getBM25DocumentCount()} SEC chunks`);
console.log("Gemini: not called | Embeddings: not generated | Pinecone: not called");

for (const item of evaluationDataset) {
  const bm25Results = searchBM25(item.question, 10);
  const pineconeResults = livePineconeCandidates?.[item.id]
    ?.map((candidate) => {
      const document = documentsById.get(candidate.id);
      return document ? {
        id: candidate.id,
        text: document.text,
        metadata: document.metadata,
        score: candidate.score,
      } : null;
    })
    .filter(Boolean) || mockPineconeCandidates(bm25Results);
  const rrfTop10 = reciprocalRankFusion(pineconeResults, bm25Results, 10);

  if (debugReranker) {
    const relevantIds = new Set(item.relevantChunkIds);
    const presentIds = rrfTop10.filter((result) => relevantIds.has(result.id)).map((result) => result.id);
    const missingIds = item.relevantChunkIds.filter((id) => !presentIds.includes(id));

    console.log(`\n${"=".repeat(100)}`);
    console.log(`${item.id}: ${item.question}`);
    console.log(`Labeled relevant IDs: ${item.relevantChunkIds.join(", ")}`);
    console.log(`Present in RRF top 10: ${presentIds.join(", ") || "none"}`);
    console.log(`Missing from RRF top 10: ${missingIds.join(", ") || "none"}`);
    console.log("\nRRF top 10 candidates:");

    rrfTop10.forEach((result, index) => {
      console.log(`\n[${index + 1}] ${result.id} | relevant: ${relevantIds.has(result.id) ? "yes" : "no"}`);
      console.log("-".repeat(100));
      console.log(result.text || result.metadata?.text || "[no text]");
    });
    continue;
  }

  const resultsByMethod = {
    Pinecone: pineconeResults,
    BM25: bm25Results,
    RRF: rrfTop10,
  };
  if (useLocal) {
    resultsByMethod["RRF + local"] = rerankLocal(item.question, rrfTop10, TOP_K);
  }
  if (useCohere) {
    resultsByMethod["RRF + Cohere"] = await rerankWithCohere(item.question, rrfTop10, TOP_K);
  }

  console.log(`\n${item.id}: ${item.question}`);
  console.log(`Relevant: ${item.relevantChunkIds.join(", ")}`);

  for (const method of methodNames) {
    const result = metrics(resultsByMethod[method], item.relevantChunkIds);
    totals[method].precision += result.precision;
    totals[method].recall += result.recall;
    totals[method].mrr += result.mrr;
    console.log(`${method.padEnd(15)} ${result.ids.join(", ") || "none"} | P@5 ${formatMetric(result.precision)} | R@5 ${formatMetric(result.recall)} | MRR ${result.mrr.toFixed(3)}`);
  }
}

const averages = Object.fromEntries(
  methodNames.map((method) => [method, {
    precision: totals[method].precision / evaluationDataset.length,
    recall: totals[method].recall / evaluationDataset.length,
    mrr: totals[method].mrr / evaluationDataset.length,
  }]),
);

if (!debugReranker) printTable(averages);

const offlineFilterCases = [
  {
    id: "products-services",
    label: "Ticker AAPL",
    filters: { ticker: "AAPL" },
  },
  {
    id: "business-risks",
    label: "Item 1A",
    filters: { item: "1A", section: "Item 1A" },
  },
  {
    id: "revenue-recognition",
    label: "10-K filing",
    filters: { filingType: "10-K", filingDate: "2025-10-31" },
  },
];

console.log("\nOffline filtered vs unfiltered RRF checks");
console.log("Fixture candidates are filtered locally; no Pinecone or embedding calls were made.");

for (const filterCase of offlineFilterCases) {
  const item = evaluationDataset.find((candidate) => candidate.id === filterCase.id);
  const bm25Unfiltered = searchBM25(item.question, 10);
  const bm25Filtered = searchBM25(item.question, 10, filterCase.filters);
  const fixtureCandidates = livePineconeCandidates?.[item.id]
    ?.map((candidate) => {
      const document = documentsById.get(candidate.id);
      return document ? {
        id: candidate.id,
        text: document.text,
        metadata: document.metadata,
        score: candidate.score,
      } : null;
    })
    .filter(Boolean) || mockPineconeCandidates(bm25Unfiltered);
  const pineconeFiltered = fixtureCandidates.filter((result) => matchesMetadata(result.metadata, filterCase.filters));
  const unfilteredRrf = reciprocalRankFusion(fixtureCandidates, bm25Unfiltered, TOP_K);
  const filteredRrf = reciprocalRankFusion(pineconeFiltered, bm25Filtered, TOP_K);
  const unfilteredMetrics = metrics(unfilteredRrf, item.relevantChunkIds);
  const filteredMetrics = metrics(filteredRrf, item.relevantChunkIds);

  console.log(`\n${item.id} / ${filterCase.label}`);
  console.log(`Filters: ${JSON.stringify(filterCase.filters)}`);
  console.log(`Unfiltered RRF: ${unfilteredMetrics.ids.join(", ") || "none"} | P@5 ${formatMetric(unfilteredMetrics.precision)} | R@5 ${formatMetric(unfilteredMetrics.recall)} | MRR ${unfilteredMetrics.mrr.toFixed(3)}`);
  console.log(`Filtered RRF:   ${filteredMetrics.ids.join(", ") || "none"} | P@5 ${formatMetric(filteredMetrics.precision)} | R@5 ${formatMetric(filteredMetrics.recall)} | MRR ${filteredMetrics.mrr.toFixed(3)}`);
}
