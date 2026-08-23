import "dotenv/config";

const requiredKeys = ["GEMINI_API_KEY", "PINECONE_API_KEY", "PINECONE_INDEX_NAME"];

function positiveInteger(env, key, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(env[key] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

export function getOperationalSettings(env = process.env) {
  return {
    requestTimeoutMs: positiveInteger(env, "UPSTREAM_TIMEOUT_MS", 30000, { min: 100, max: 120000 }),
    retryMaxAttempts: positiveInteger(env, "UPSTREAM_MAX_ATTEMPTS", 3, { min: 1, max: 5 }),
    retryBaseDelayMs: positiveInteger(env, "UPSTREAM_RETRY_BASE_MS", 250, { min: 0, max: 10000 }),
    rateLimitWindowMs: positiveInteger(env, "RATE_LIMIT_WINDOW_MS", 60000, { min: 1000, max: 3600000 }),
    rateLimitMax: positiveInteger(env, "RATE_LIMIT_MAX", 30, { min: 1, max: 10000 }),
    cacheTtlMs: positiveInteger(env, "CHAT_CACHE_TTL_MS", 60000, { min: 1000, max: 86400000 }),
    cacheMaxEntries: positiveInteger(env, "CHAT_CACHE_MAX_ENTRIES", 100, { min: 1, max: 10000 }),
  };
}

export function getConfig(env = process.env) {
  const missing = requiredKeys.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const configuredOrigins = (env.FRONTEND_ORIGINS || env.FRONTEND_URL || "")
    .split(",").map((origin) => origin.trim().replace(/\/$/, "")).filter(Boolean);
  const localOrigins = env.NODE_ENV === "production" ? [] : ["http://localhost:3000", "http://127.0.0.1:3000"];
  const allowedOrigins = [...new Set([...configuredOrigins, ...localOrigins])];

  const port = positiveInteger(env, "PORT", 5000, { min: 1, max: 65535 });
  const host = (env.HOST || "0.0.0.0").trim();
  if (!host) throw new Error("HOST must not be empty.");
  return { port, host, allowedOrigins, ...getOperationalSettings(env) };
}
