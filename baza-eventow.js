const { DatabaseSync } = require("node:sqlite");
const { randomUUID } = require("node:crypto");
const { mkdirSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");

const domyslnaSciezkaBazy = join(__dirname, "data", "pulse.sqlite");

function utworzEvent({ tytul, status = "aktywny", typWydarzenia = "nieokreslony" }) {
  for (const wartosc of [tytul, status, typWydarzenia]) {
    if (typeof wartosc !== "string" || wartosc.trim() === "") {
      throw new TypeError("Tytuł, status i typ wydarzenia muszą być niepustymi tekstami.");
    }
  }

  const teraz = new Date().toISOString();
  return {
    id: randomUUID(),
    tytul: tytul.trim(),
    status: status.trim(),
    dataRozpoczecia: teraz,
    ostatniaAktualizacja: teraz,
    typWydarzenia: typWydarzenia.trim(),
  };
}

function utworzNews({ tytul, url, dataPublikacji = null, autor = null, zrodlo = null }) {
  const dataPobrania = new Date().toISOString();
  for (const wartosc of [tytul, url]) {
    if (typeof wartosc !== "string" || wartosc.trim() === "") {
      throw new TypeError("Tytuł i URL NEWS-a muszą być niepustymi tekstami.");
    }
  }
  for (const wartosc of [autor, zrodlo]) {
    if (wartosc !== null && typeof wartosc !== "string") {
      throw new TypeError("Autor i źródło NEWS-a muszą być tekstami lub null.");
    }
  }

  if (dataPublikacji !== null) {
    // Jawna strefa zapobiega interpretowaniu czasu źródła w lokalnej strefie Pulse.
    if (typeof dataPublikacji !== "string" ||
        !/(Z|[+-]\d{2}:?\d{2})$/i.test(dataPublikacji.trim()) ||
        !Number.isFinite(Date.parse(dataPublikacji))) {
      throw new TypeError("Data publikacji musi być poprawną datą ze strefą czasową lub null.");
    }
    dataPublikacji = new Date(dataPublikacji).toISOString();
  }

  return {
    id: randomUUID(),
    tytul: tytul.trim(),
    dataPublikacji,
    dataPobrania,
    autor,
    zrodlo,
    url: url.trim(),
  };
}

function otworzBazeEventow(sciezka = domyslnaSciezkaBazy) {
  const pelnaSciezka = resolve(sciezka);
  mkdirSync(dirname(pelnaSciezka), { recursive: true });
  const baza = new DatabaseSync(pelnaSciezka);

  try {
    baza.exec("PRAGMA foreign_keys = ON");
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
        tytul TEXT NOT NULL CHECK (length(trim(tytul)) > 0),
        dataPublikacji TEXT,
        dataPobrania TEXT NOT NULL,
        autor TEXT,
        zrodlo TEXT,
        url TEXT NOT NULL CHECK (length(trim(url)) > 0)
      );

      CREATE TABLE IF NOT EXISTS EVENT_NEWS (
        eventId TEXT NOT NULL REFERENCES EVENT(id),
        newsId TEXT NOT NULL REFERENCES NEWS(id),
        PRIMARY KEY (eventId, newsId)
      );

      CREATE INDEX IF NOT EXISTS idx_event_news_newsId ON EVENT_NEWS(newsId);
    `);

    const zapis = baza.prepare(`
      INSERT INTO EVENT (id, tytul, status, dataRozpoczecia, ostatniaAktualizacja, typWydarzenia)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const odczyt = baza.prepare(`
      SELECT id, tytul, status, dataRozpoczecia, ostatniaAktualizacja, typWydarzenia
      FROM EVENT ORDER BY dataRozpoczecia, id
    `);
    const zapisNewsa = baza.prepare(`
      INSERT INTO NEWS (id, tytul, dataPublikacji, dataPobrania, autor, zrodlo, url)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const odczytNewsow = baza.prepare(`
      SELECT id, tytul, dataPublikacji, dataPobrania, autor, zrodlo, url
      FROM NEWS ORDER BY dataPobrania, id
    `);
    const zapisPowiazania = baza.prepare(`
      INSERT INTO EVENT_NEWS (eventId, newsId) VALUES (?, ?)
    `);
    const newsyEventu = baza.prepare(`
      SELECT n.id, n.tytul, n.dataPublikacji, n.dataPobrania, n.autor, n.zrodlo, n.url
      FROM NEWS AS n JOIN EVENT_NEWS AS en ON en.newsId = n.id
      WHERE en.eventId = ? ORDER BY n.dataPobrania, n.id
    `);
    const eventyNewsa = baza.prepare(`
      SELECT e.id, e.tytul, e.status, e.dataRozpoczecia, e.ostatniaAktualizacja, e.typWydarzenia
      FROM EVENT AS e JOIN EVENT_NEWS AS en ON en.eventId = e.id
      WHERE en.newsId = ? ORDER BY e.dataRozpoczecia, e.id
    `);

    return {
      zapiszEvent(event) {
        zapis.run(
          event.id,
          event.tytul,
          event.status,
          event.dataRozpoczecia,
          event.ostatniaAktualizacja,
          event.typWydarzenia,
        );
      },
      pobierzEventy() {
        return odczyt.all().map((event) => ({ ...event }));
      },
      zapiszNews(news) {
        zapisNewsa.run(
          news.id, news.tytul, news.dataPublikacji, news.dataPobrania,
          news.autor, news.zrodlo, news.url,
        );
      },
      pobierzNewsy() {
        return odczytNewsow.all().map((news) => ({ ...news }));
      },
      powiazNewsZEventem(newsId, eventId) {
        zapisPowiazania.run(eventId, newsId);
      },
      pobierzNewsyEventu(eventId) {
        return newsyEventu.all(eventId).map((news) => ({ ...news }));
      },
      pobierzEventyNewsa(newsId) {
        return eventyNewsa.all(newsId).map((event) => ({ ...event }));
      },
      zamknij() {
        baza.close();
      },
    };
  } catch (error) {
    baza.close();
    throw error;
  }
}

module.exports = { otworzBazeEventow, utworzEvent, utworzNews };
