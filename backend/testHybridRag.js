import "dotenv/config";

import { generateAnswer } from "./services/chatService.js";

const question = "What products does Apple sell?";

console.log("\n==============================");
console.log("FINRAG HYBRID RAG TEST");
console.log("==============================");

console.log("\nQuestion:");
console.log(question);

try {
  const result = await generateAnswer(question);

  console.log("\n==============================");
  console.log("ANSWER");
  console.log("==============================");

  console.log(result.answer);

  console.log("\n==============================");
  console.log("SOURCES");
  console.log("==============================");

  result.sources.forEach((source, index) => {
    console.log(`\nSOURCE ${index + 1}`);
    console.log("------------------------------");

    console.log("ID:", source.id);
    console.log("RRF Score:", source.score);
    console.log("Vector Score:", source.vectorScore ?? "N/A");
    console.log("BM25 Score:", source.bm25Score ?? "N/A");
    console.log("Company:", source.company);
    console.log("Ticker:", source.ticker);
    console.log("Filing:", source.filingType);
    console.log("Item:", source.item);
    console.log("Section:", source.section);
    console.log("URL:", source.sourceUrl);
  });
} catch (error) {
  console.error("\nRAG TEST FAILED:");
  console.error(error);
}