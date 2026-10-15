const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, readdirSync, unlinkSync, rmdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { openDatabase } = require("../storage");
const { prepareAiInputs } = require("../prepare-ai-inputs");
const { classifyNewsWithAI } = require("../classify-news");
const { runAiDemo } = require("../demo-ai");

const article = { newsId: "news-1", source: "Example", title: "A central bank raises rates", publishedAt: null };
const classification = {
  categories: ["economy", "finance"],
  marketRelevance: "high",
  summary: "The title reports a central bank rate increase.",
  reasoning: "A rate change may affect borrowing costs; this is a title-only assessment.",
};

function createDatabasePath(t) {
  const directory = mkdtempSync(join(tmpdir(), "pulse-ai-test-"));
  t.after(() => {
    for (const file of readdirSync(directory)) unlinkSync(join(directory, file));
    rmdirSync(directory);
  });
  return join(directory, "test.sqlite");
}

test("AI inputs use the latest saved version and skip identities without versions", (t) => {
  const databasePath = createDatabasePath(t);
  const database = openDatabase(databasePath);
  const sql = new DatabaseSync(databasePath);
  try {
    const news = database.saveNews({ title: "Original", url: "https://example.com/a", source: "Example" });
    database.saveNews({ title: "Updated", url: news.url, publishedAt: "2026-10-15T12:00:00+02:00" });
    sql.prepare("INSERT INTO NEWS (id, url, zrodlo, dataPobrania) VALUES (?, ?, ?, ?)")
      .run("no-version", "https://example.com/empty", null, new Date().toISOString());
    assert.deepEqual(prepareAiInputs(database), [{
      newsId: news.id, source: "Example", title: "Updated", publishedAt: "2026-10-15T10:00:00.000Z",
    }]);
    assert.equal(database.getNewsItems().length, 2); // Preparation leaves the connection open.
    assert.equal(database.getNewsVersions(news.id).length, 2);
  } finally {
    sql.close();
    database.close();
  }
});

test("preparing an empty database returns no AI inputs", (t) => {
  const database = openDatabase(createDatabasePath(t));
  try { assert.deepEqual(prepareAiInputs(database), []); }
  finally { database.close(); }
});

test("classification parses JSON and identifies its limited evidence scope", async () => {
  let request;
  const client = { async generate(input) { request = input; return JSON.stringify(classification); } };
  assert.deepEqual(await classifyNewsWithAI(article, client), {
    newsId: article.newsId, analysisScope: "title-only", ...classification,
  });
  assert.deepEqual(JSON.parse(request.prompt).article, article);
  assert.match(request.system, /meaning and context/);
  assert.match(request.system, /not read or verified the full article/);
  assert.match(request.system, /untrusted data/);
  assert.equal(request.format.additionalProperties, false);
  assert.deepEqual(request.format.required, ["categories", "marketRelevance", "summary", "reasoning"]);
});

test("classification rejects malformed JSON and responses outside the schema", async () => {
  const invalid = [
    "not JSON", '```json\n{}\n```', "null", "[]", "{}",
    JSON.stringify({ ...classification, categories: [] }),
    JSON.stringify({ ...classification, categories: ["unknown"] }),
    JSON.stringify({ ...classification, categories: ["finance", "finance"] }),
    JSON.stringify({ ...classification, marketRelevance: "critical" }),
    JSON.stringify({ ...classification, summary: " " }),
    JSON.stringify({ ...classification, summary: "x".repeat(601) }),
    JSON.stringify({ ...classification, reasoning: null }),
    JSON.stringify({ ...classification, reasoning: "x".repeat(601) }),
    JSON.stringify({ ...classification, extra: true }),
  ];
  for (const response of invalid) {
    await assert.rejects(classifyNewsWithAI(article, { async generate() { return response; } }), /AI classification/);
  }
});

test("invalid articles are rejected before calling AI and client errors are preserved", async () => {
  let called = false;
  await assert.rejects(classifyNewsWithAI({ newsId: "n", title: " " }, {
    async generate() { called = true; },
  }), /newsId and title/);
  assert.equal(called, false);
  const failure = new Error("Simulated AI connection failure");
  await assert.rejects(classifyNewsWithAI(article, { async generate() { throw failure; } }),
    (error) => error === failure);
});

function mockDatabase(articleCount) {
  return {
    closed: false,
    getNewsItems() { return Array.from({ length: articleCount }, (_, i) => ({ id: `n-${i}`, source: null })); },
    getLatestNewsVersion() { return { title: article.title, publishedAt: null }; },
    close() { this.closed = true; },
  };
}

test("demo classifies at most three articles sequentially and closes storage", async (t) => {
  t.mock.method(console, "log", () => {});
  const database = mockDatabase(5);
  const seen = [];
  let active = 0;
  const client = { async generate({ prompt }) {
    active++;
    assert.equal(active, 1);
    await Promise.resolve();
    seen.push(JSON.parse(prompt).article.newsId);
    active--;
    return JSON.stringify(classification);
  } };
  await runAiDemo({ client, openDatabaseFn: () => database });
  assert.deepEqual(seen, ["n-0", "n-1", "n-2"]);
  assert.equal(database.closed, true);
});

test("demo closes storage after an AI error and skips the client for empty input", async (t) => {
  t.mock.method(console, "log", () => {});
  const database = mockDatabase(1);
  await assert.rejects(runAiDemo({ openDatabaseFn: () => database,
    client: { async generate() { throw new Error("AI failure"); } },
  }), /AI failure/);
  assert.equal(database.closed, true);
  const empty = mockDatabase(0);
  await runAiDemo({ openDatabaseFn: () => empty,
    client: { async generate() { assert.fail("AI must not run for empty input"); } },
  });
  assert.equal(empty.closed, true);
});

test("importing AI modules opens no database and sends no request", () => {
  const script = `
    require('node:sqlite').DatabaseSync = class { constructor() { throw new Error('Unexpected database access'); } };
    globalThis.fetch = () => { throw new Error('Unexpected network access'); };
    for (const name of ['prepare-ai-inputs', 'ollama-client', 'classify-news', 'ai-input', 'demo-ai']) require('./' + name);
  `;
  const result = spawnSync(process.execPath, ["-e", script], { cwd: resolve(__dirname, ".."), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
