import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import companyRoutes from "./companyRoutes.js";

function request(app, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const req = http.request({ hostname: "127.0.0.1", port, method: "POST", path, headers: { "content-type": "application/json", ...headers } }, (res) => { let data = ""; res.on("data", (chunk) => { data += chunk; }); res.on("end", () => { server.close(); resolve({ status: res.statusCode, body: JSON.parse(data) }); }); });
      req.on("error", reject); req.end(JSON.stringify({ forms: ["10-K"] }));
    });
  });
}

const company = { cik: "0000000001", ticker: "TEST", name: "Test Holdings" };
function makeApp() { const app = express(); app.use(express.json()); app.use("/api/companies", companyRoutes({ auth: { required: true, verify: async (token) => ({ sub: token }) }, ingestionAdminUserIds: "user_admin", getDirectory: async () => [company], enqueue: async () => ({ duplicate: false, job: { id: "job_1", status: "QUEUED", cik: company.cik } }) })); return app; }

test("ingestion endpoint requires a verified authorized Clerk user", async () => {
  const missing = await request(makeApp(), `/api/companies/${company.cik}/ingestion`);
  assert.equal(missing.status, 401);
  const denied = await request(makeApp(), `/api/companies/${company.cik}/ingestion`, { authorization: "Bearer user_other" });
  assert.equal(denied.status, 403);
  const allowed = await request(makeApp(), `/api/companies/${company.cik}/ingestion`, { authorization: "Bearer user_admin" });
  assert.equal(allowed.status, 202);
  assert.equal(allowed.body.data.job.status, "QUEUED");
});
