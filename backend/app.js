import express from "express";
import { chatController } from "./controllers/chatController.js";
import chatRoutes from "./routes/chatRoutes.js";

export function createApp({ generateAnswer, allowedOrigins = [] } = {}) {
  const app = express();
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!origin) return next();
    if (!allowedOrigins.includes(origin)) {
      return res.status(403).json({ success: false, error: { code: "CORS_FORBIDDEN", message: "Origin is not allowed." } });
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.status(204).end();
    return next();
  });

  app.use(express.json({ limit: "32kb" }));
  app.get("/api/health", (req, res) => res.json({ success: true, data: { status: "ok", message: "FinRAG backend is running" } }));
  app.use("/api/chat", chatRoutes({ generateAnswer }));

  app.use((req, res) => res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Route not found." } }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof SyntaxError && "body" in error) {
      return res.status(400).json({ success: false, error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } });
    }
    console.error("Unhandled API error:", error);
    return res.status(error.statusCode || 500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Unable to process the request." } });
  });
  return app;
}

