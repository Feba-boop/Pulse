const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createOllamaClient } = require("../ollama-client");

const settings = { model: "test-local-model", baseUrl: "http://127.0.0.1:11434", timeoutMs: 1000 };
const request = { prompt: "Test article", system: "Test instructions", format: { type: "object" } };

test("Ollama client sends a non-streaming structured request through injected fetch", async () => {
  let calls = 0;
  const client = createOllamaClient({ ...settings, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(String(url), "http://127.0.0.1:11434/api/generate");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(options.body), {
      model: settings.model, ...request, stream: false, options: { temperature: 0 },
    });
    return { ok: true, json: async () => ({ done: true, response: '{"ok":true}' }) };
  } });
  assert.equal(calls, 0);
  assert.equal(await client.generate(request), '{"ok":true}');
  assert.equal(calls, 1);
});

test("Ollama client reports HTTP failures and unavailable models", async () => {
  for (const status of [404, 500]) {
    const client = createOllamaClient({ ...settings,
      fetchImpl: async () => ({ ok: false, status }),
    });
    await assert.rejects(client.generate(request), new RegExp(`Ollama HTTP ${status}`));
  }
});

test("Ollama client explains connection failures and retains their cause", async () => {
  const failure = new TypeError("fetch failed");
  const client = createOllamaClient({ ...settings, fetchImpl: async () => { throw failure; } });
  await assert.rejects(client.generate(request), (error) =>
    /Could not connect to Ollama/.test(error.message) && error.cause === failure);
});

test("Ollama client rejects invalid JSON, error envelopes, and incomplete generation", async () => {
  const responses = [
    { ok: true, json: async () => { throw new SyntaxError("bad JSON"); } },
    { ok: true, json: async () => null },
    { ok: true, json: async () => ({ error: "model not found" }) },
    { ok: true, json: async () => ({ done: false, response: "partial" }) },
    { ok: true, json: async () => ({ done: true, response: {} }) },
  ];
  for (const response of responses) {
    const client = createOllamaClient({ ...settings, fetchImpl: async () => response });
    await assert.rejects(client.generate(request), /Ollama returned/);
  }
});

test("timeout aborts a stalled request without a running server", async () => {
  let signal;
  const client = createOllamaClient({ ...settings, timeoutMs: 10,
    fetchImpl: async (url, options) => {
      signal = options.signal;
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  });
  await assert.rejects(client.generate(request), /timed out after 10 ms/);
  assert.equal(signal.aborted, true);
});

test("timeout also covers a stalled response body", async () => {
  const client = createOllamaClient({ ...settings, timeoutMs: 10,
    fetchImpl: async (url, { signal }) => ({ ok: true,
      json: () => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    }),
  });
  await assert.rejects(client.generate(request), /timed out after 10 ms/);
});

test("Ollama client validates configuration before any request", () => {
  const fetchImpl = () => assert.fail("Invalid configuration must not send a request");
  for (const model of ["", null, "example:cloud"]) {
    assert.throws(() => createOllamaClient({ ...settings, model, fetchImpl }), /model/i);
  }
  for (const timeoutMs of [0, -1, NaN, 1.5, 2147483648]) {
    assert.throws(() => createOllamaClient({ ...settings, timeoutMs, fetchImpl }), /TIMEOUT/);
  }
  assert.throws(() => createOllamaClient({ ...settings, baseUrl: "https://example.com", fetchImpl }), /local HTTP/);
});
