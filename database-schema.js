const { randomUUID } = require("node:crypto");

function initializeSchema(database) {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS EVENT (
        id TEXT PRIMARY KEY NOT NULL,
        tytul TEXT NOT NULL CHECK (length(trim(tytul)) > 0),
        status TEXT NOT NULL CHECK (length(trim(status)) > 0),
        dataRozpoczecia TEXT NOT NULL,
        ostatniaAktualizacja TEXT NOT NULL,
        typWydarzenia TEXT NOT NULL CHECK (length(trim(typWydarzenia)) > 0)
      );
      CREATE TABLE IF NOT EXISTS NEWS (
        id TEXT PRIMARY KEY NOT NULL,
        url TEXT NOT NULL CHECK (length(trim(url)) > 0),
        zrodlo TEXT,
        dataPobrania TEXT NOT NULL
      );
    `);
    const duplicate = database.prepare(`
      SELECT url FROM NEWS GROUP BY url HAVING count(*) > 1 LIMIT 1
    `).get();
    if (duplicate) {
      throw new Error(`NEWS migration aborted: duplicate URL ${JSON.stringify(duplicate.url)}. No data was merged or deleted.`);
    }
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_news_url ON NEWS(url);
      CREATE TABLE IF NOT EXISTS NEWS_VERSION (
        id TEXT PRIMARY KEY NOT NULL,
        newsId TEXT NOT NULL REFERENCES NEWS(id),
        tytul TEXT NOT NULL CHECK (length(trim(tytul)) > 0),
        dataPublikacji TEXT,
        dataWersji TEXT NOT NULL,
        autor TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_news_version_newsId_dataWersji
        ON NEWS_VERSION(newsId, dataWersji);
      CREATE TABLE IF NOT EXISTS EVENT_NEWS (
        eventId TEXT NOT NULL REFERENCES EVENT(id),
        newsId TEXT NOT NULL REFERENCES NEWS(id),
        PRIMARY KEY (eventId, newsId)
      );
      CREATE INDEX IF NOT EXISTS idx_event_news_newsId ON EVENT_NEWS(newsId);
    `);

    const isLegacySchema = database.prepare("PRAGMA table_info(NEWS)").all()
      .some((column) => column.name === "tytul");
    if (isLegacySchema) {
      const insertLegacyVersion = database.prepare(`
        INSERT INTO NEWS_VERSION (id, newsId, tytul, dataPublikacji, dataWersji, autor)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const news of database.prepare("SELECT id, url, zrodlo AS source, dataPobrania AS firstSeenAt, tytul AS title, autor AS author, dataPublikacji AS publishedAt FROM NEWS").all()) {
        insertLegacyVersion.run(randomUUID(), news.id, news.title, news.publishedAt,
          news.firstSeenAt, news.author);
      }
      // Drop only the migrated columns; NEWS records and their IDs remain in place.
      database.exec(`
        ALTER TABLE NEWS DROP COLUMN tytul;
        ALTER TABLE NEWS DROP COLUMN dataPublikacji;
        ALTER TABLE NEWS DROP COLUMN autor;
      `);
    }
    if (database.prepare("PRAGMA foreign_key_check").all().length > 0) {
      throw new Error("Migration aborted: the database contains invalid foreign keys.");
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

module.exports = { initializeSchema };
