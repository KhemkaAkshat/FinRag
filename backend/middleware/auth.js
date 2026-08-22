import { verifyToken } from "@clerk/backend";

export function createAuthMiddleware({
  required = Boolean(process.env.CLERK_SECRET_KEY),
  secretKey = process.env.CLERK_SECRET_KEY,
  verify = (token) => verifyToken(token, { secretKey }),
} = {}) {
  return async (req, res, next) => {
    if (!required) return next();
    const authorization = req.headers.authorization || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!token) return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Sign in to use FinRAG chat." } });
    try {
      req.auth = await verify(token);
      return next();
    } catch {
      return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Your session is invalid or expired. Please sign in again." } });
    }
  };
}
