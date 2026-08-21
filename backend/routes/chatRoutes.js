import express from "express";
import { chatController } from "../controllers/chatController.js";

export default function chatRoutes({ generateAnswer } = {}) {
  const router = express.Router();

  router.post("/", chatController({ generateAnswer }));

  return router;
}
