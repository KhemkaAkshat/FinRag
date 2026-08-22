import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { Pinecone } from "@pinecone-database/pinecone";
import { evaluationDataset } from "./evaluationDataset.js";
import { generateQueryEmbedding } from "./services/ragService.js";

const OUTPUT_PATH = path.resolve(process.cwd(), "evaluation", "live-pinecone-results.json");
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.index(process.env.PINECONE_INDEX_NAME);

console.warn("WARNING: this script consumes exactly 8 Gemini embedding requests—one per evaluation question.");
console.warn("It does not generate document embeddings or modify Pinecone data.\n");

const results = {};

for (const item of evaluationDataset) {
  console.log(`Collecting Pinecone candidates for ${item.id}...`);
  const queryVector = await generateQueryEmbedding(item.question);
  const response = await index.query({
    vector: queryVector,
    topK: 10,
    includeMetadata: false,
  });

  results[item.id] = (response.matches || []).map((match) => ({
    id: match.id,
    score: match.score,
  }));
}

await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await fs.writeFile(
  OUTPUT_PATH,
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    questions: results,
  }, null, 2),
  "utf8",
);

console.log(`\nSaved ranked Pinecone IDs and scores to ${OUTPUT_PATH}`);
