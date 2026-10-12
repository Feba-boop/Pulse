const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { mkdtempSync, readdirSync, unlinkSync, rmdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { openDatabase, createEvent, createNews } = require("../storage");

function createTestDatabasePath(t) {
  const directory = mkdtempSync(join(tmpdir(), "pulse-version-test-"));
  t.after(() => {
    for (const file of readdirSync(directory)) unlinkSync(join(directory, file));
    rmdirSync(directory);
  });
  return join(directory, "test.sqlite");
}

const article = { url: "https://example.com/a", title: "Pierwszy tytuł", author: null,
  publishedAt: "2020-01-01T12:00:00Z", source: "Wydawca" };

test("First save creates news and a version; identical data leaves state unchanged", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-07T10:00:00Z") });
  const database = openDatabase(createTestDatabasePath(t));
  try {
    const news = database.saveNews(createNews(article));
    const version = database.getLatestNewsVersion(news.id);
    assert.deepEqual(database.getNewsItems(), [news]);
    assert.deepEqual(database.getNewsVersions(news.id), [version]);
    assert.equal(news.firstSeenAt, "2026-10-07T10:00:00.000Z");
    assert.equal(version.versionDetectedAt, news.firstSeenAt);
    assert.equal(version.publishedAt, "2020-01-01T12:00:00.000Z");
    t.mock.timers.tick(1000);
    assert.deepEqual(database.saveNews(article), news);
    assert.deepEqual(database.getNewsVersions(news.id), [version]);
    assert.deepEqual(database.findNewsByUrl(article.url), news);
    assert.deepEqual(database.getNews(news.id), news);
    assert.equal(database.getNews("brak"), null);
    assert.equal(database.findNewsByUrl("brak"), null);
    assert.equal(database.getLatestNewsVersion("brak"), null);
    assert.deepEqual(database.getNewsVersions("brak"), []);
  } finally { database.close(); }
});

test("Title, author, and date changes create versions that persist after reopening", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-07T10:00:00Z") });
  const databasePath = createTestDatabasePath(t);
  let database = openDatabase(databasePath);
  let news, history;
  try {
    news = database.saveNews(article);
    const changes = [
      { ...article, title: "Nowy tytuł" },
      { ...article, title: "Nowy tytuł", author: "John Smith" },
      { ...article, title: "Nowy tytuł", author: "John Smith", publishedAt: null },
      article, // Returning to previous values creates another version in the history.
    ];
    for (const articleData of changes) {
      t.mock.timers.tick(1000);
      assert.deepEqual(database.saveNews(articleData), news);
    }
    history = database.getNewsVersions(news.id);
    assert.equal(history.length, 5);
    assert.equal(new Set(history.map((w) => w.id)).size, 5);
    assert.deepEqual(history.map((w) => w.title),
      [article.title, "Nowy tytuł", "Nowy tytuł", "Nowy tytuł", article.title]);
    assert.deepEqual(history.map((w) => w.author), [null, null, "John Smith", "John Smith", null]);
    assert.deepEqual(history.map((w) => w.publishedAt),
      ["2020-01-01T12:00:00.000Z", "2020-01-01T12:00:00.000Z", "2020-01-01T12:00:00.000Z", null, "2020-01-01T12:00:00.000Z"]);
    assert.deepEqual(history.map((w) => w.versionDetectedAt), [0, 1, 2, 3, 4].map((s) => `2026-10-07T10:00:0${s}.000Z`));
    assert.deepEqual(database.getLatestNewsVersion(news.id), history[4]);
  } finally { database.close(); }
  database = openDatabase(databasePath);
  try {
    assert.deepEqual(database.getNewsItems(), [news]);
    assert.deepEqual(database.getNewsVersions(news.id), history);
    database.saveNews(article);
    assert.deepEqual(database.getNewsVersions(news.id), history);
  } finally { database.close(); }
});

test("Versions detected in the same millisecond retain insertion order", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1700000000000 });
  const database = openDatabase(createTestDatabasePath(t));
  try {
    const news = database.saveNews(article);
    database.saveNews({ ...article, title: "Drugi" });
    database.saveNews({ ...article, title: "Trzeci" });
    database.saveNews({ ...article, title: "Trzeci" });
    assert.deepEqual(database.getNewsVersions(news.id).map((w) => w.title), [article.title, "Drugi", "Trzeci"]);
    assert.equal(database.getLatestNewsVersion(news.id).title, "Trzeci");
  } finally { database.close(); }
});

test("URLs are not normalized; source and first-seen time remain fixed", (t) => {
  const database = openDatabase(createTestDatabasePath(t));
  try {
    const news = database.saveNews(article);
    assert.deepEqual(database.saveNews({ ...article, source: "Inne" }), news);
    assert.equal(database.getNewsVersions(news.id).length, 1);
    for (const url of [article.url + "/", " " + article.url, "https://EXAMPLE.com/a"]) {
      assert.equal(database.saveNews({ ...article, url }).url, url);
    }
    assert.equal(database.getNewsItems().length, 4);
  } finally { database.close(); }
});

test("SQLite enforces unique URLs, foreign keys, and atomic writes", (t) => {
  const databasePath = createTestDatabasePath(t);
  const database = openDatabase(databasePath);
  const sql = new DatabaseSync(databasePath);
  try {
    sql.exec("PRAGMA foreign_keys = ON");
    const news = database.saveNews(article);
    assert.throws(() => sql.prepare("INSERT INTO NEWS VALUES (?, ?, ?, ?)").run(
      "inne-id", news.url, news.source, news.firstSeenAt), /UNIQUE constraint failed/);
    assert.throws(() => sql.prepare("INSERT INTO NEWS_VERSION VALUES (?, ?, ?, ?, ?, ?)").run(
      "wersja", "nieistniejacy", "Tytuł", null, news.firstSeenAt, null), /FOREIGN KEY constraint failed/);
    sql.exec(`CREATE TRIGGER reject_version BEFORE INSERT ON NEWS_VERSION
      BEGIN SELECT RAISE(ABORT, 'test write failure'); END`);
    assert.throws(() => database.saveNews({ ...article, url: "https://example.com/new" }), /test write failure/);
    assert.equal(database.findNewsByUrl("https://example.com/new"), null);
    assert.equal(database.getNewsItems().length, 1);
  } finally { sql.close(); database.close(); }
});

test("Many-to-many links persist after adding versions and reopening", (t) => {
  const databasePath = createTestDatabasePath(t);
  let database = openDatabase(databasePath);
  const eventA = createEvent({ title: "A" });
  const eventB = createEvent({ title: "B" });
  let newsA, newsB;
  try {
    database.saveEvent(eventA); database.saveEvent(eventB);
    newsA = database.saveNews(article);
    newsB = database.saveNews({ ...article, url: "https://example.com/b" });
    database.linkNewsToEvent(newsA.id, eventA.id);
    database.linkNewsToEvent(newsA.id, eventB.id);
    database.linkNewsToEvent(newsB.id, eventA.id);
    database.saveNews({ ...article, title: "Aktualizacja" });
  } finally { database.close(); }
  database = openDatabase(databasePath);
  try {
    assert.deepEqual(database.getNewsForEvent(eventA.id).map((n) => n.id).sort(), [newsA.id, newsB.id].sort());
    assert.deepEqual(database.getEventsForNews(newsA.id).map((e) => e.id).sort(), [eventA.id, eventB.id].sort());
    assert.deepEqual(database.getNewsForEvent(eventB.id), [newsA]);
    assert.deepEqual(database.getEventsForNews(newsB.id), [eventA]);
    assert.throws(() => database.linkNewsToEvent(newsA.id, eventA.id), /UNIQUE constraint failed/);
    assert.throws(() => database.linkNewsToEvent("brak", eventA.id), /FOREIGN KEY constraint failed/);
    assert.throws(() => database.linkNewsToEvent(newsA.id, "brak"), /FOREIGN KEY constraint failed/);
    assert.deepEqual(database.getNewsForEvent("' OR 1=1 --"), []);
    assert.deepEqual(database.getEventsForNews("brak"), []);
  } finally { database.close(); }
});

test("Null and SQL-like text are preserved; invalid input is rejected", (t) => {
  const database = openDatabase(createTestDatabasePath(t));
  try {
    const title = "O'Reilly: '); DROP TABLE NEWS; --";
    const news = database.saveNews({ title, url: "https://example.com/?q='" });
    const version = database.getLatestNewsVersion(news.id);
    assert.equal(version.title, title);
    assert.equal(version.publishedAt, null);
    assert.equal(version.author, null);
    assert.equal(news.source, null);
    for (const articleData of [{ ...article, title: " " }, { ...article, url: " " },
      { ...article, publishedAt: "niepoprawna" }, { ...article, publishedAt: "2020-01-01T12:00:00" }]) {
      assert.throws(() => database.saveNews(articleData), TypeError);
    }
    assert.equal(database.getNewsItems().length, 1);
  } finally { database.close(); }
});

function createLegacyDatabase(databasePath, duplicate = false) {
  const sql = new DatabaseSync(databasePath);
  try {
    sql.exec(`
      CREATE TABLE EVENT (id TEXT PRIMARY KEY NOT NULL, tytul TEXT NOT NULL,
        status TEXT NOT NULL, dataRozpoczecia TEXT NOT NULL, ostatniaAktualizacja TEXT NOT NULL, typWydarzenia TEXT NOT NULL);
      CREATE TABLE NEWS (id TEXT PRIMARY KEY NOT NULL, tytul TEXT NOT NULL CHECK(length(trim(tytul)) > 0),
        dataPublikacji TEXT, dataPobrania TEXT NOT NULL, autor TEXT, zrodlo TEXT,
        url TEXT NOT NULL CHECK(length(trim(url)) > 0));
      CREATE TABLE EVENT_NEWS (eventId TEXT NOT NULL REFERENCES EVENT(id),
        newsId TEXT NOT NULL REFERENCES NEWS(id), PRIMARY KEY(eventId, newsId));
    `);
    sql.prepare("INSERT INTO EVENT VALUES (?, ?, ?, ?, ?, ?)").run("event", "Stary EVENT", "aktywny", "2020", "2020", "test");
    sql.prepare("INSERT INTO NEWS VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      "news", "Stary tytuł", "2019-12-31T12:00:00Z", "2020-01-01T12:00:00Z", "Autor", "Źródło", article.url);
    sql.prepare("INSERT INTO EVENT_NEWS VALUES (?, ?)").run("event", "news");
    if (duplicate) {
      sql.prepare("INSERT INTO NEWS VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        "news2", "Inny tytuł", null, "2020-01-02T12:00:00Z", null, null, article.url);
      sql.prepare("INSERT INTO EVENT_NEWS VALUES (?, ?)").run("event", "news2");
    }
    return {
      newsItems: sql.prepare("SELECT id, url, zrodlo AS source, dataPobrania AS firstSeenAt, tytul AS title, autor AS author, dataPublikacji AS publishedAt FROM NEWS").all().map((n) => ({ ...n })),
      events: sql.prepare("SELECT id, tytul AS title, status, dataRozpoczecia AS startedAt, ostatniaAktualizacja AS updatedAt, typWydarzenia AS eventType FROM EVENT").all().map((e) => ({ ...e })),
      links: sql.prepare("SELECT * FROM EVENT_NEWS").all().map((r) => ({ ...r })),
    };
  } finally { sql.close(); }
}

test("Migration preserves legacy data and links; reopening is idempotent", (t) => {
  const databasePath = createTestDatabasePath(t);
  const legacyData = createLegacyDatabase(databasePath);
  let version;
  for (let i = 0; i < 2; i++) {
    const database = openDatabase(databasePath);
    try {
      const { id, url, source, firstSeenAt, title, author, publishedAt } = legacyData.newsItems[0];
      const news = { id, url, source, firstSeenAt };
      assert.deepEqual(database.getNewsItems(), [news]);
      assert.deepEqual(database.getEvents(), legacyData.events);
      assert.deepEqual(database.getNewsForEvent("event"), [news]);
      assert.deepEqual(database.getEventsForNews("news"), legacyData.events);
      const history = database.getNewsVersions("news");
      assert.equal(history.length, 1);
      if (!version) version = history[0];
      assert.deepEqual(history, [version]);
      assert.deepEqual(version, { id: version.id, newsId: id, title, author, publishedAt, versionDetectedAt: firstSeenAt });
      assert.deepEqual(database.saveNews({ url, source, title, author,
        publishedAt: "2019-12-31T13:00:00+01:00" }), news);
      assert.deepEqual(database.getNewsVersions(id), [version]);
    } finally { database.close(); }
  }
});

test("Equivalent timestamp formats create no version; a changed instant does", (t) => {
  const database = openDatabase(createTestDatabasePath(t));
  try {
    const news = database.saveNews({ ...article, publishedAt: "2020-01-01T14:00:00+02:00" });
    const firstVersion = database.getLatestNewsVersion(news.id);
    assert.equal(firstVersion.publishedAt, "2020-01-01T12:00:00.000Z");
    for (const publishedAt of ["2020-01-01T12:00:00Z", "2020-01-01T12:00:00.000Z",
      "2020-01-01T07:00:00-05:00", "2020-01-01T14:00:00+0200"]) {
      assert.deepEqual(database.saveNews({ ...article, publishedAt }), news);
      assert.deepEqual(database.getNewsVersions(news.id), [firstVersion]);
    }
    database.saveNews({ ...article, publishedAt: "2020-01-01T12:00:00.001Z" });
    assert.equal(database.getNewsVersions(news.id).length, 2);
    database.saveNews({ ...article, publishedAt: null });
    database.saveNews({ ...article, publishedAt: null });
    assert.equal(database.getNewsVersions(news.id).length, 3);
    assert.equal(database.getLatestNewsVersion(news.id).publishedAt, null);
  } finally { database.close(); }
});

test("Historical versions are compared after date normalization without rewriting history", (t) => {
  const databasePath = createTestDatabasePath(t);
  let database = openDatabase(databasePath);
  let news;
  try { news = database.saveNews(article); } finally { database.close(); }
  const sql = new DatabaseSync(databasePath);
  try {
    sql.prepare("UPDATE NEWS_VERSION SET dataPublikacji = ? WHERE newsId = ?")
      .run("2020-01-01T14:00:00+02:00", news.id);
  } finally { sql.close(); }
  for (let i = 0; i < 2; i++) {
    database = openDatabase(databasePath);
    try {
      const history = database.getNewsVersions(news.id);
      assert.equal(history[0].publishedAt, "2020-01-01T14:00:00+02:00");
      assert.deepEqual(database.saveNews(article), news);
      assert.deepEqual(database.getNewsVersions(news.id), history);
    } finally { database.close(); }
  }
});

test("Migration with duplicate URLs rolls back without deleting data", (t) => {
  const databasePath = createTestDatabasePath(t);
  const legacyData = createLegacyDatabase(databasePath, true);
  for (let i = 0; i < 2; i++) {
    assert.throws(() => openDatabase(databasePath), /NEWS migration aborted: duplicate URL/);
    const sql = new DatabaseSync(databasePath);
    try {
      assert.deepEqual(sql.prepare("SELECT id, url, zrodlo AS source, dataPobrania AS firstSeenAt, tytul AS title, autor AS author, dataPublikacji AS publishedAt FROM NEWS").all().map((n) => ({ ...n })), legacyData.newsItems);
      assert.deepEqual(sql.prepare("SELECT id, tytul AS title, status, dataRozpoczecia AS startedAt, ostatniaAktualizacja AS updatedAt, typWydarzenia AS eventType FROM EVENT").all().map((e) => ({ ...e })), legacyData.events);
      assert.deepEqual(sql.prepare("SELECT * FROM EVENT_NEWS").all().map((r) => ({ ...r })), legacyData.links);
      assert.equal(sql.prepare("SELECT name FROM sqlite_master WHERE name = 'NEWS_VERSION'").get(), undefined);
    } finally { sql.close(); }
  }
});
