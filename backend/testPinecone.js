import "dotenv/config";

import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { TaskType } from "@google/generative-ai";

const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
  taskType: TaskType.RETRIEVAL_DOCUMENT,
});

const text = "Apple reported cybersecurity risks in its annual filing.";

console.log("Testing embedQuery...");

const queryVector = await embeddings.embedQuery(text);

console.log("Query vector length:", queryVector.length);

console.log("\nTesting embedDocuments...");

const documentVectors = await embeddings.embedDocuments([
  text,
  "Apple's revenue increased during the fiscal year."
]);

console.log(
  "Document vectors length:",
  documentVectors.length
);

console.log(
  "First document vector length:",
  documentVectors[0]?.length
);

console.log(
  "Second document vector length:",
  documentVectors[1]?.length
);