import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "./app.js";

function request(app, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const req = http.request({ hostname: "127.0.0.1", port, method: "POST", path: "/api/chat", headers: { "content-type": "application/json", ...headers } }, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => { server.close(); resolve({ status: res.statusCode, body: JSON.parse(data) }); });
      });
      req.on("error", reject); req.end(JSON.stringify({ question: "test" }));
    });
  });
}

const appOptions = { generateAnswer: async () => ({ answer: "ok", sources: [] }), auth: { required: true, verify: async (token) => { if (token !== "good") throw new Error("bad token"); return { sub: "user_1" }; } } };

test("protected chat rejects missing Clerk token", async () => {
  const response = await request(createApp(appOptions));
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, "UNAUTHENTICATED");
});

test("protected chat accepts a verified injected token", async () => {
  const response = await request(createApp(appOptions), { authorization: "Bearer good" });
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
});
