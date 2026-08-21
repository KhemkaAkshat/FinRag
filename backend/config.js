import "dotenv/config";

const requiredKeys = ["GEMINI_API_KEY", "PINECONE_API_KEY", "PINECONE_INDEX_NAME"];

export function getConfig(env = process.env) {
  const missing = requiredKeys.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const allowedOrigins = (env.FRONTEND_ORIGINS || env.FRONTEND_URL || "http://localhost:3000")
    .split(",").map((origin) => origin.trim()).filter(Boolean);

  return { port: Number(env.PORT || 5000), allowedOrigins };
}

