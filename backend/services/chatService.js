import "dotenv/config";

import { GoogleGenAI } from "@google/genai";

import { searchDocuments } from "./ragService.js";
import { extractQueryFilters } from "./queryUnderstandingService.js";
import { getOperationalSettings } from "../config.js";
import { createSingleFlightCache, createTtlCache, UpstreamServiceError, withRetry } from "./resilienceService.js";
import { createRedisCache, getRedisClient } from "./redisService.js";

const CHAT_MODEL = "gemini-3.5-flash";
const settings = getOperationalSettings();
let ai;

function getGeminiClient() {
  if (ai) return ai;
  if (!process.env.GEMINI_API_KEY?.trim()) {
    throw new UpstreamServiceError("Gemini credentials are not configured.", {
      code: "CONFIGURATION_ERROR",
      statusCode: 503,
    });
  }
  ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return ai;
}
const memoryCache = createTtlCache({ ttlMs: settings.cacheTtlMs, maxEntries: settings.cacheMaxEntries });
const remoteCache = createRedisCache({ client: getRedisClient(), ttlMs: settings.cacheTtlMs });
const answerCache = createSingleFlightCache({
  cache: {
    async get(key) {
      const remote = await remoteCache.get(key);
      return remote === undefined ? memoryCache.get(key) : remote;
    },
    async set(key, value) {
      memoryCache.set(key, value);
      await remoteCache.set(key, value);
    },
    clear() { memoryCache.clear(); },
  },
  keyFor: (question) => question.trim().replace(/\s+/g, " ").toLowerCase(),
});

async function generateAnswerUncached(question) {
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

  const response = await withRetry(
    () => getGeminiClient().models.generateContent({ model: CHAT_MODEL, contents: prompt }),
    {
      label: "Gemini generation",
      timeoutMs: settings.requestTimeoutMs,
      maxAttempts: settings.retryMaxAttempts,
      baseDelayMs: settings.retryBaseDelayMs,
    },
  );

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

export function clearAnswerCache() {
  answerCache.clear();
}

export async function generateAnswer(question) {
  return answerCache.getOrCreate(question, () => generateAnswerUncached(question));
}
