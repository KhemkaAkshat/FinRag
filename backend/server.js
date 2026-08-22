import { createApp } from "./app.js";
import { getConfig } from "./config.js";

const config = getConfig();
const app = createApp({
  allowedOrigins: config.allowedOrigins,
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
