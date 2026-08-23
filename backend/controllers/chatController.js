import { generateAnswer } from "../services/chatService.js";

const MAX_QUESTION_LENGTH = 2000;

export function chatController({ generateAnswer: injectedGenerator } = {}) {
  const answerGenerator = injectedGenerator || generateAnswer;

  return async function handleChat(req, res, next) {
    try {
      const body = req.body;
      const question = body?.question;
      if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Request body must be an object." } });
      }
      if (typeof question !== "string") {
        return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Question must be a string." } });
      }

      const trimmedQuestion = question.trim();
      if (!trimmedQuestion) {
        return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Question cannot be empty." } });
      }
      if (trimmedQuestion.length > MAX_QUESTION_LENGTH) {
        return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: `Question cannot exceed ${MAX_QUESTION_LENGTH} characters.` } });
      }

      const result = await answerGenerator(trimmedQuestion);
      if (["COMPANY_NOT_INDEXED", "AMBIGUOUS_COMPANY"].includes(result?.code)) {
        return res.status(409).json({ success: false, error: { code: result.code, message: result.message, details: result.details } });
      }
      if (result?.code === "COMPANY_NOT_FOUND") {
        return res.status(404).json({ success: false, error: { code: result.code, message: result.message, details: result.details } });
      }
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  };
}
