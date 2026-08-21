import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "./app.js";

function request(app, { method = "GET", path = "/", body, rawBody, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const payload = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
      const req = http.request({ hostname: "127.0.0.1", port, method, path,
        headers: { ...(payload ? { "content-type": "application/json" } : {}), ...headers } }, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => { server.close(); resolve({ status: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : null }); });
      });
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  });
}

const answer = async (question) => ({ answer: `Answer for ${question}`, sources: [] });

test("health uses the success envelope", async () => {
  const response = await request(createApp({ generateAnswer: answer }), { path: "/api/health" });
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.status, "ok");
});

test("chat trims valid questions and returns data", async () => {
  let received;
  const response = await request(createApp({ generateAnswer: async (question) => { received = question; return { answer: "ok", sources: [] }; } }), { method: "POST", path: "/api/chat", body: { question: "  What is revenue?  " } });
  assert.equal(response.status, 200);
  assert.equal(received, "What is revenue?");
  assert.deepEqual(response.body, { success: true, data: { answer: "ok", sources: [] } });
});

for (const [name, body, message] of [
  ["missing question", {}, "Question must be a string."],
  ["empty question", { question: "  " }, "Question cannot be empty."],
  ["non-string question", { question: 42 }, "Question must be a string."],
]) {
  test(`chat rejects ${name}`, async () => {
    const response = await request(createApp({ generateAnswer: answer }), { method: "POST", path: "/api/chat", body });
    assert.equal(response.status, 400);
    assert.equal(response.body.success, false);
    assert.equal(response.body.error.message, message);
  });
}

test("chat maps service failures through the centralized handler", async () => {
  const response = await request(createApp({ generateAnswer: async () => { throw new Error("provider down"); } }), { method: "POST", path: "/api/chat", body: { question: "test" } });
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { success: false, error: { code: "INTERNAL_ERROR", message: "Unable to process the request." } });
});

test("invalid JSON and unknown routes return consistent errors", async () => {
  const invalid = await request(createApp({ generateAnswer: answer }), { method: "POST", path: "/api/chat", rawBody: "{not-json", headers: { "content-type": "application/json" } });
  assert.equal(invalid.status, 400);
  const unknown = await request(createApp({ generateAnswer: answer }), { path: "/nope" });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, "NOT_FOUND");
});

test("allowed CORS origins receive headers", async () => {
  const response = await request(createApp({ generateAnswer: answer, allowedOrigins: ["http://localhost:3000"] }), { path: "/api/health", headers: { origin: "http://localhost:3000" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers["access-control-allow-origin"], "http://localhost:3000");
});
