const { DatabaseSync } = require("node:sqlite");
const { randomUUID } = require("node:crypto");
const { mkdirSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");
const { przygotujSchemat } = require("./schemat-bazy");

const domyslnaSciezkaBazy = join(__dirname, "data", "pulse.sqlite");

function utworzEvent({
  tytul,
  status = "aktywny",
  typWydarzenia = "nieokreslony",
}) {
  for (const wartosc of [tytul, status, typWydarzenia]) {
    if (typeof wartosc !== "string" || wartosc.trim() === "") {
      throw new TypeError(
        "Tytuł, status i typ wydarzenia muszą być niepustymi tekstami.",
      );
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

// Historyczne daty bez poprawnej, jawnej strefy pozostawiamy bez interpretacji.
function normalizujDatePublikacji(data) {
  if (typeof data === "string" &&
      /(Z|[+-]\d{2}:?\d{2})$/i.test(data.trim()) &&
      Number.isFinite(Date.parse(data))) {
    return new Date(data).toISOString();
  }
  return data;
}

function utworzNews({
  tytul,
  url,
  dataPublikacji = null,
  autor = null,
  zrodlo = null,
}) {
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
    if (
      typeof dataPublikacji !== "string" ||
      !/(Z|[+-]\d{2}:?\d{2})$/i.test(dataPublikacji.trim()) ||
      !Number.isFinite(Date.parse(dataPublikacji))
    ) {
      throw new TypeError(
        "Data publikacji musi być poprawną datą ze strefą czasową lub null.",
      );
    }
  }

  return {
    tytul,
    dataPublikacji: normalizujDatePublikacji(dataPublikacji),
    autor,
    zrodlo,
    url,
  };
}

function otworzBazeEventow(sciezka = domyslnaSciezkaBazy) {
  const pelnaSciezka = resolve(sciezka);
  mkdirSync(dirname(pelnaSciezka), { recursive: true });
  const baza = new DatabaseSync(pelnaSciezka);

  try {
    baza.exec("PRAGMA foreign_keys = ON");
    przygotujSchemat(baza);

    const zapis = baza.prepare(`
      INSERT INTO EVENT (id, tytul, status, dataRozpoczecia, ostatniaAktualizacja, typWydarzenia)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const odczyt = baza.prepare(`
      SELECT id, tytul, status, dataRozpoczecia, ostatniaAktualizacja, typWydarzenia
      FROM EVENT ORDER BY dataRozpoczecia, id
    `);
    const zapisNewsa = baza.prepare(`
      INSERT INTO NEWS (id, url, zrodlo, dataPobrania) VALUES (?, ?, ?, ?)
    `);
    const odczytNewsow = baza.prepare(`
      SELECT id, url, zrodlo, dataPobrania
      FROM NEWS ORDER BY dataPobrania, id
    `);
    const zapisPowiazania = baza.prepare(`
      INSERT INTO EVENT_NEWS (eventId, newsId) VALUES (?, ?)
    `);
    const newsyEventu = baza.prepare(`
      SELECT n.id, n.url, n.zrodlo, n.dataPobrania
      FROM NEWS AS n JOIN EVENT_NEWS AS en ON en.newsId = n.id
      WHERE en.eventId = ? ORDER BY n.dataPobrania, n.id
    `);
    const eventyNewsa = baza.prepare(`
      SELECT e.id, e.tytul, e.status, e.dataRozpoczecia, e.ostatniaAktualizacja, e.typWydarzenia
      FROM EVENT AS e JOIN EVENT_NEWS AS en ON en.eventId = e.id
      WHERE en.newsId = ? ORDER BY e.dataRozpoczecia, e.id
    `);
    const newsPoUrl = baza.prepare(
      "SELECT id, url, zrodlo, dataPobrania FROM NEWS WHERE url = ?",
    );
    const newsPoId = baza.prepare(
      "SELECT id, url, zrodlo, dataPobrania FROM NEWS WHERE id = ?",
    );
    const wersje = baza.prepare(`
      SELECT id, newsId, tytul, dataPublikacji, dataWersji, autor FROM NEWS_VERSION
      WHERE newsId = ? ORDER BY dataWersji, rowid
    `);
    const najnowsza = baza.prepare(`
      SELECT id, newsId, tytul, dataPublikacji, dataWersji, autor FROM NEWS_VERSION
      WHERE newsId = ? ORDER BY dataWersji DESC, rowid DESC LIMIT 1
    `);
    const zapisWersji = baza.prepare(`
      INSERT INTO NEWS_VERSION (id, newsId, tytul, dataPublikacji, dataWersji, autor)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const obiektLubNull = (wiersz) => (wiersz ? { ...wiersz } : null);

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
      zapiszNews(dane) {
        const artykul = utworzNews(dane);
        baza.exec("BEGIN IMMEDIATE");
        try {
          const teraz = new Date().toISOString();
          let news = newsPoUrl.get(artykul.url);
          if (!news) {
            news = {
              id: randomUUID(),
              url: artykul.url,
              zrodlo: artykul.zrodlo,
              dataPobrania: teraz,
            };
            zapisNewsa.run(news.id, news.url, news.zrodlo, news.dataPobrania);
          }
          const ostatnia = najnowsza.get(news.id);
          if (
            !ostatnia ||
            ostatnia.tytul !== artykul.tytul ||
            normalizujDatePublikacji(ostatnia.dataPublikacji) !== artykul.dataPublikacji ||
            ostatnia.autor !== artykul.autor
          ) {
            zapisWersji.run(
              randomUUID(),
              news.id,
              artykul.tytul,
              artykul.dataPublikacji,
              teraz,
              artykul.autor,
            );
          }
          baza.exec("COMMIT");
          return { ...news };
        } catch (error) {
          baza.exec("ROLLBACK");
          throw error;
        }
      },
      znajdzNewsPoUrl(url) {
        return obiektLubNull(newsPoUrl.get(url));
      },
      pobierzNews(id) {
        return obiektLubNull(newsPoId.get(id));
      },
      pobierzWersjeNewsa(newsId) {
        return wersje.all(newsId).map((wersja) => ({ ...wersja }));
      },
      pobierzNajnowszaWersjeNewsa(newsId) {
        return obiektLubNull(najnowsza.get(newsId));
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
