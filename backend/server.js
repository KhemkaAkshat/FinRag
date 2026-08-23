import { createApp } from "./app.js";
import { getConfig } from "./config.js";
import { getRedisClient } from "./services/redisService.js";

const config = getConfig();
const app = createApp({
  allowedOrigins: config.allowedOrigins,
  auth: { required: Boolean(process.env.CLERK_SECRET_KEY) },
  redis: getRedisClient(),
  rateLimit: { windowMs: config.rateLimitWindowMs, max: config.rateLimitMax },
});

const server = app.listen(config.port, config.host, () => {
  console.log(`FinRAG backend running on ${config.host}:${config.port}`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down gracefully.`);
  server.close((error) => {
    if (error) {
      console.error("Graceful shutdown failed.");
      process.exitCode = 1;
    }
    process.exit();
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
