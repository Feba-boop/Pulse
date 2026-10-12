const { randomUUID } = require("node:crypto");

function przygotujSchemat(baza) {
  baza.exec("BEGIN IMMEDIATE");
  try {
    baza.exec(`
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
    const duplikat = baza.prepare(`
      SELECT url FROM NEWS GROUP BY url HAVING count(*) > 1 LIMIT 1
    `).get();
    if (duplikat) {
      throw new Error(`Migracja NEWS przerwana: zduplikowany URL ${JSON.stringify(duplikat.url)}. Dane nie zostały scalone ani usunięte.`);
    }
    baza.exec(`
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

    const starySchemat = baza.prepare("PRAGMA table_info(NEWS)").all()
      .some((kolumna) => kolumna.name === "tytul");
    if (starySchemat) {
      const dodajWersje = baza.prepare(`
        INSERT INTO NEWS_VERSION (id, newsId, tytul, dataPublikacji, dataWersji, autor)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const news of baza.prepare("SELECT * FROM NEWS").all()) {
        dodajWersje.run(randomUUID(), news.id, news.tytul, news.dataPublikacji,
          news.dataPobrania, news.autor);
      }
      // Usuwamy tylko przeniesione kolumny; rekordy NEWS i ich ID pozostają na miejscu.
      baza.exec(`
        ALTER TABLE NEWS DROP COLUMN tytul;
        ALTER TABLE NEWS DROP COLUMN dataPublikacji;
        ALTER TABLE NEWS DROP COLUMN autor;
      `);
    }
    if (baza.prepare("PRAGMA foreign_key_check").all().length > 0) {
      throw new Error("Migracja przerwana: baza zawiera niepoprawne klucze obce.");
    }
    baza.exec("COMMIT");
  } catch (error) {
    baza.exec("ROLLBACK");
    throw error;
  }
}

module.exports = { przygotujSchemat };
