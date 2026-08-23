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

export function createRedisCache({ client, prefix = process.env.REDIS_CACHE_PREFIX || "finrag:cache:", ttlMs = 60000 } = {}) {
  const resolveClient = () => client === undefined ? getRedisClient() : client;
  return {
    async get(key) {
      try {
        const activeClient = resolveClient();
        if (!activeClient?.isReady) return undefined;
        const value = await activeClient.get(`${prefix}${key}`);
        return value === null ? undefined : JSON.parse(value);
      } catch (error) {
        console.warn(`[redis] cache read failed: ${error.message}`);
        return undefined;
      }
    },
    async set(key, value) {
      try {
        const activeClient = resolveClient();
        if (activeClient?.isReady) await activeClient.set(`${prefix}${key}`, JSON.stringify(value), { PX: ttlMs });
      } catch (error) {
        console.warn(`[redis] cache write failed: ${error.message}`);
      }
    },
  };
}
