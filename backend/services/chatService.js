import "dotenv/config";

import { GoogleGenAI } from "@google/genai";

import { searchDocuments } from "./ragService.js";
import { extractQueryFilters } from "./queryUnderstandingService.js";
import { getOperationalSettings } from "../config.js";
import { createSingleFlightCache, createTtlCache, UpstreamServiceError, withRetry } from "./resilienceService.js";
import { createRedisCache } from "./redisService.js";
import { resolveCompanyReference } from "./secService.js";
import { getIndexedCompanyStatus } from "./companyIndexService.js";

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
const remoteCache = createRedisCache({ ttlMs: settings.cacheTtlMs });
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
  const companyResolution = await resolveCompanyReference(question);
  if (companyResolution.status === "AMBIGUOUS") {
    return {
      code: "AMBIGUOUS_COMPANY",
      message: "Several SEC companies match that description. Select the company you meant before searching.",
      answer: "Several SEC companies match that description. Select the company you meant before searching.",
      sources: [],
      details: { query: question, candidates: companyResolution.candidates },
    };
  }
  if (companyResolution.status === "NOT_FOUND") {
    return {
      code: "COMPANY_NOT_FOUND",
      message: "I could not match that company to the SEC company directory.",
      answer: "I could not match that company to the SEC company directory. Check the company name or ticker and try again.",
      sources: [],
      details: { query: question },
    };
  }
  const selectedCompany = companyResolution.status === "RESOLVED" ? companyResolution.company : null;
  if (selectedCompany) {
    const companyStatus = await getIndexedCompanyStatus(selectedCompany);
    if (!companyStatus.indexed) {
      return {
        code: "COMPANY_NOT_INDEXED",
        message: `${selectedCompany.name} (${selectedCompany.ticker}) has been identified, but its SEC filings are not indexed in FinRAG yet.`,
        answer: `${selectedCompany.name} (${selectedCompany.ticker}) has been identified, but its SEC filings are not indexed in FinRAG yet. An administrator must explicitly ingest the latest 10-K or 10-Q before it can be searched.`,
        sources: [],
        details: { company: selectedCompany, candidates: companyResolution.candidates, searchTerm: companyResolution.searchTerm, query: question, status: "NOT_READY", indexed: false },
      };
    }
    filters.company = selectedCompany.name;
    filters.ticker = selectedCompany.ticker;
    filters.cik = selectedCompany.cik;
  }
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
