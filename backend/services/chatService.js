import "dotenv/config";

import { GoogleGenAI } from "@google/genai";

import { searchDocuments } from "./ragService.js";
import { extractQueryFilters } from "./queryUnderstandingService.js";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const CHAT_MODEL = "gemini-3.5-flash";

export async function generateAnswer(
  question
) {
  console.log("\nSearching knowledge base...");

  const filters = extractQueryFilters(question);
  const matches =
    await searchDocuments(question, 5, filters);

  if (matches.length === 0) {
    return {
      answer:
        "I couldn't find relevant information in the available SEC filings.",
      sources: [],
    };
  }

  const context = matches
    .map((match, index) => {
      return `[Source ${index + 1}]
Company: ${match.metadata?.company}
Ticker: ${match.metadata?.ticker}
Filing: ${match.metadata?.filingType}
Item: ${match.metadata?.item}
Section: ${match.metadata?.section}

${match.metadata?.text}`;
    })
    .join("\n\n");

  const prompt = `
You are a financial research assistant.

Answer the user's question using ONLY the information
provided in the context below.

If the context does not contain enough information to
answer the question, say that the information is not
available in the provided filing.

Do not make up facts.

User question:
${question}

Context:
${context}
`;

  console.log(
    "Generating answer with Gemini..."
  );

  const response =
    await ai.models.generateContent({
      model: CHAT_MODEL,
      contents: prompt,
    });

  const answer =
    response.text || 
    "Unable to generate an answer.";

  const sources = matches.map(
    (match) => ({
      id: match.id,
      score: match.rrfScore,
      rrfScore: match.rrfScore,
      vectorScore: match.vectorScore,
      bm25Score: match.bm25Score,
      company:
        match.metadata?.company,
      ticker:
        match.metadata?.ticker,
      filingType:
        match.metadata?.filingType,
      item:
        match.metadata?.item,
      section:
        match.metadata?.section,
      sourceUrl:
        match.metadata?.sourceUrl,
    })
  );

  return {
    answer,
    sources,
  };
}
