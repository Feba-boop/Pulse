const { DatabaseSync } = require("node:sqlite");
const { randomUUID } = require("node:crypto");
const { mkdirSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");
const { initializeSchema } = require("./database-schema");

const defaultDatabasePath = join(__dirname, "data", "pulse.sqlite");

function createEvent({
  title,
  status = "aktywny",
  eventType = "nieokreslony",
}) {
  for (const value of [title, status, eventType]) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(
        "Event title, status, and type must be non-empty strings.",
      );
    }
  }

  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: title.trim(),
    status: status.trim(),
    startedAt: now,
    updatedAt: now,
    eventType: eventType.trim(),
  };
}

// Leave historical dates without a valid explicit timezone uninterpreted.
function normalizePublicationDate(dateValue) {
  if (typeof dateValue === "string" &&
      /(Z|[+-]\d{2}:?\d{2})$/i.test(dateValue.trim()) &&
      Number.isFinite(Date.parse(dateValue))) {
    return new Date(dateValue).toISOString();
  }
  return dateValue;
}

function createNews({
  title,
  url,
  publishedAt = null,
  author = null,
  source = null,
}) {
  for (const value of [title, url]) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError("News title and URL must be non-empty strings.");
    }
  }
  for (const value of [author, source]) {
    if (value !== null && typeof value !== "string") {
      throw new TypeError("News author and source must be strings or null.");
    }
  }

  if (publishedAt !== null) {
    // An explicit timezone prevents interpreting source timestamps in the local timezone.
    if (
      typeof publishedAt !== "string" ||
      !/(Z|[+-]\d{2}:?\d{2})$/i.test(publishedAt.trim()) ||
      !Number.isFinite(Date.parse(publishedAt))
    ) {
      throw new TypeError(
        "Publication date must be a valid date with an explicit timezone or null.",
      );
    }
  }

  return {
    title,
    publishedAt: normalizePublicationDate(publishedAt),
    author,
    source,
    url,
  };
}

function openDatabase(databasePath = defaultDatabasePath) {
  const absoluteDatabasePath = resolve(databasePath);
  mkdirSync(dirname(absoluteDatabasePath), { recursive: true });
  const database = new DatabaseSync(absoluteDatabasePath);

  try {
    database.exec("PRAGMA foreign_keys = ON");
    initializeSchema(database);

    const insertEvent = database.prepare(`
      INSERT INTO EVENT (id, tytul, status, dataRozpoczecia, ostatniaAktualizacja, typWydarzenia)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const selectEvents = database.prepare(`
      SELECT id, tytul AS title, status, dataRozpoczecia AS startedAt, ostatniaAktualizacja AS updatedAt, typWydarzenia AS eventType
      FROM EVENT ORDER BY dataRozpoczecia, id
    `);
    const insertNews = database.prepare(`
      INSERT INTO NEWS (id, url, zrodlo, dataPobrania) VALUES (?, ?, ?, ?)
    `);
    const selectNews = database.prepare(`
      SELECT id, url, zrodlo AS source, dataPobrania AS firstSeenAt
      FROM NEWS ORDER BY dataPobrania, id
    `);
    const insertLink = database.prepare(`
      INSERT INTO EVENT_NEWS (eventId, newsId) VALUES (?, ?)
    `);
    const selectEventNews = database.prepare(`
      SELECT n.id, n.url, n.zrodlo AS source, n.dataPobrania AS firstSeenAt
      FROM NEWS AS n JOIN EVENT_NEWS AS en ON en.newsId = n.id
      WHERE en.eventId = ? ORDER BY n.dataPobrania, n.id
    `);
    const selectNewsEvents = database.prepare(`
      SELECT e.id, e.tytul AS title, e.status, e.dataRozpoczecia AS startedAt, e.ostatniaAktualizacja AS updatedAt, e.typWydarzenia AS eventType
      FROM EVENT AS e JOIN EVENT_NEWS AS en ON en.eventId = e.id
      WHERE en.newsId = ? ORDER BY e.dataRozpoczecia, e.id
    `);
    const selectNewsByUrl = database.prepare(
      "SELECT id, url, zrodlo AS source, dataPobrania AS firstSeenAt FROM NEWS WHERE url = ?",
    );
    const selectNewsById = database.prepare(
      "SELECT id, url, zrodlo AS source, dataPobrania AS firstSeenAt FROM NEWS WHERE id = ?",
    );
    const selectVersions = database.prepare(`
      SELECT id, newsId, tytul AS title, dataPublikacji AS publishedAt, dataWersji AS versionDetectedAt, autor AS author FROM NEWS_VERSION
      WHERE newsId = ? ORDER BY dataWersji, rowid
    `);
    const selectLatestVersion = database.prepare(`
      SELECT id, newsId, tytul AS title, dataPublikacji AS publishedAt, dataWersji AS versionDetectedAt, autor AS author FROM NEWS_VERSION
      WHERE newsId = ? ORDER BY dataWersji DESC, rowid DESC LIMIT 1
    `);
    const insertVersion = database.prepare(`
      INSERT INTO NEWS_VERSION (id, newsId, tytul, dataPublikacji, dataWersji, autor)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const toObjectOrNull = (row) => (row ? { ...row } : null);

    return {
      saveEvent(event) {
        insertEvent.run(
          event.id,
          event.title,
          event.status,
          event.startedAt,
          event.updatedAt,
          event.eventType,
        );
      },
      getEvents() {
        return selectEvents.all().map((event) => ({ ...event }));
      },
      saveNews(articleData) {
        const article = createNews(articleData);
        database.exec("BEGIN IMMEDIATE");
        try {
          const now = new Date().toISOString();
          let news = selectNewsByUrl.get(article.url);
          if (!news) {
            news = {
              id: randomUUID(),
              url: article.url,
              source: article.source,
              firstSeenAt: now,
            };
            insertNews.run(news.id, news.url, news.source, news.firstSeenAt);
          }
          const latestVersion = selectLatestVersion.get(news.id);
          if (
            !latestVersion ||
            latestVersion.title !== article.title ||
            normalizePublicationDate(latestVersion.publishedAt) !== article.publishedAt ||
            latestVersion.author !== article.author
          ) {
            insertVersion.run(
              randomUUID(),
              news.id,
              article.title,
              article.publishedAt,
              now,
              article.author,
            );
          }
          database.exec("COMMIT");
          return { ...news };
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
      },
      findNewsByUrl(url) {
        return toObjectOrNull(selectNewsByUrl.get(url));
      },
      getNews(id) {
        return toObjectOrNull(selectNewsById.get(id));
      },
      getNewsVersions(newsId) {
        return selectVersions.all(newsId).map((version) => ({ ...version }));
      },
      getLatestNewsVersion(newsId) {
        return toObjectOrNull(selectLatestVersion.get(newsId));
      },
      getNewsItems() {
        return selectNews.all().map((news) => ({ ...news }));
      },
      linkNewsToEvent(newsId, eventId) {
        insertLink.run(eventId, newsId);
      },
      getNewsForEvent(eventId) {
        return selectEventNews.all(eventId).map((news) => ({ ...news }));
      },
      getEventsForNews(newsId) {
        return selectNewsEvents.all(newsId).map((event) => ({ ...event }));
      },
      close() {
        database.close();
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

module.exports = { openDatabase, createEvent, createNews };
