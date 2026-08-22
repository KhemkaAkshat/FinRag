import { createClient } from "redis";

let sharedClient;
let connectionAttempt;

export function getRedisClient({ url = process.env.REDIS_URL } = {}) {
  if (!url?.trim()) return null;
  if (sharedClient) return sharedClient;
  if (!connectionAttempt) {
    sharedClient = createClient({ url });
    sharedClient.on("error", (error) => console.warn(`[redis] unavailable: ${error.message}`));
    connectionAttempt = sharedClient.connect().catch((error) => {
      console.warn(`[redis] connection failed; using in-memory fallback: ${error.message}`);
      sharedClient = null;
      connectionAttempt = null;
    });
  }
  return sharedClient;
}

export function createRedisCache({ client = getRedisClient(), prefix = process.env.REDIS_CACHE_PREFIX || "finrag:cache:", ttlMs = 60000 } = {}) {
  return {
    async get(key) {
      try {
        if (!client?.isReady) return undefined;
        const value = await client.get(`${prefix}${key}`);
        return value === null ? undefined : JSON.parse(value);
      } catch (error) {
        console.warn(`[redis] cache read failed: ${error.message}`);
        return undefined;
      }
    },
    async set(key, value) {
      try {
        if (client?.isReady) await client.set(`${prefix}${key}`, JSON.stringify(value), { PX: ttlMs });
      } catch (error) {
        console.warn(`[redis] cache write failed: ${error.message}`);
      }
    },
  };
}
