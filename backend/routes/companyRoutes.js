import express from "express";
import { createAuthMiddleware } from "../middleware/auth.js";
import { findCompany, getCompanyDirectory } from "../services/secService.js";
import { getIndexedCompanyStatus } from "../services/companyIndexService.js";
import { getIngestionStatus, requestIngestion } from "../services/ingestionQueue.js";

function adminIds(value = process.env.CLERK_INGESTION_ADMIN_USER_IDS || "") {
  return value.split(",").map((id) => id.trim()).filter(Boolean);
}

export default function companyRoutes({ auth, ingestionAdminUserIds, getDirectory = getCompanyDirectory, status = getIndexedCompanyStatus, ingestionStatus = getIngestionStatus, enqueue = requestIngestion } = {}) {
  const router = express.Router();
  const requireAuth = createAuthMiddleware(auth || { required: false });
  const requireIngestionAdmin = (req, res, next) => {
    const allowed = adminIds(ingestionAdminUserIds);
    if (!req.auth?.sub) return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Sign in is required for company indexing." } });
    if (!allowed.includes(req.auth.sub)) return res.status(403).json({ success: false, error: { code: "INGESTION_FORBIDDEN", message: "Your account is not authorized to index companies." } });
    return next();
  };

  router.get("/search", async (req, res, next) => {
    try {
      const query = String(req.query.q || "").trim();
      if (!query) return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Company search query is required." } });
      return res.json({ success: true, data: { matches: await findCompany(query) } });
    } catch (error) { return next(error); }
  });

  router.get("/:cik/status", requireAuth, async (req, res, next) => {
    try {
      const directory = await getDirectory();
      const company = directory.find((entry) => entry.cik === String(req.params.cik).padStart(10, "0"));
      if (!company) return res.status(404).json({ success: false, error: { code: "COMPANY_NOT_FOUND", message: "Company was not found in the SEC company directory." } });
      return res.json({ success: true, data: { indexed: await status(company), ingestion: await ingestionStatus(company.cik, { company }) } });
    } catch (error) { return next(error); }
  });

  router.post("/:cik/ingestion", requireAuth, requireIngestionAdmin, async (req, res, next) => {
    try {
      const directory = await getDirectory();
      const company = directory.find((entry) => entry.cik === String(req.params.cik).padStart(10, "0"));
      if (!company) return res.status(404).json({ success: false, error: { code: "COMPANY_NOT_FOUND", message: "Company was not found in the SEC company directory." } });
      const forms = Array.isArray(req.body?.forms) && req.body.forms.length ? req.body.forms : ["10-K", "10-Q"];
      if (forms.some((form) => !["10-K", "10-Q"].includes(String(form).toUpperCase()))) return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Forms must contain only 10-K or 10-Q." } });
      const result = await enqueue({ company, forms: [...new Set(forms.map((form) => String(form).toUpperCase()))] });
      return res.status(result.duplicate ? 200 : 202).json({ success: true, data: result });
    } catch (error) { return next(error); }
  });

  return router;
}
