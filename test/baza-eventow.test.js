const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, readdirSync, unlinkSync, rmdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { otworzBazeEventow, utworzEvent, utworzNews } = require("../baza-eventow");

function przygotujSciezke(t) {
  const katalog = mkdtempSync(join(tmpdir(), "pulse-event-test-"));
  t.after(() => {
    for (const plik of readdirSync(katalog)) {
      unlinkSync(join(katalog, plik));
    }
    rmdirSync(katalog);
  });
  return join(katalog, "test.sqlite");
}

test("EVENT zachowuje wszystkie pola po zamknięciu i ponownym otwarciu bazy", (t) => {
  const sciezka = przygotujSciezke(t);
  const event = utworzEvent({ tytul: "Firma O'Reilly: test '); DROP TABLE EVENT; --" });
  const baza = otworzBazeEventow(sciezka);
  try {
    assert.deepEqual(baza.pobierzEventy(), []);
    baza.zapiszEvent(event);
    assert.throws(() => baza.zapiszEvent(event), /UNIQUE constraint failed/);
  } finally {
    baza.zamknij();
  }

  const ponownie = otworzBazeEventow(sciezka);
  try {
    assert.deepEqual(ponownie.pobierzEventy(), [event]);
  } finally {
    ponownie.zamknij();
  }
});

test("demonstracja zapisuje raz i odczytuje ten sam EVENT w drugim procesie", (t) => {
  const sciezka = przygotujSciezke(t);
  const demo = resolve(__dirname, "../demo-event.js");
  const pierwszy = spawnSync(process.execPath, [demo, sciezka], { encoding: "utf8", cwd: tmpdir() });
  assert.equal(pierwszy.status, 0, pierwszy.stderr);
  assert.match(pierwszy.stdout, /Zapisano demonstracyjny EVENT/);

  const drugi = spawnSync(process.execPath, [demo, sciezka], { encoding: "utf8", cwd: tmpdir() });
  assert.equal(drugi.status, 0, drugi.stderr);
  assert.match(drugi.stdout, /Odczytano EVENT/);
  const odczytajWynik = (wynik) => JSON.parse(wynik.stdout.slice(wynik.stdout.indexOf("[")));
  assert.deepEqual(odczytajWynik(drugi), odczytajWynik(pierwszy));
  assert.equal(odczytajWynik(drugi).length, 1);
});

test("nowy EVENT ma unikalne ID, daty UTC i nie przyjmuje pustego tytułu", () => {
  const pierwszy = utworzEvent({ tytul: "Pierwszy" });
  const drugi = utworzEvent({ tytul: "Drugi" });
  assert.notEqual(pierwszy.id, drugi.id);
  assert.equal(pierwszy.dataRozpoczecia, pierwszy.ostatniaAktualizacja);
  assert.equal(new Date(pierwszy.dataRozpoczecia).toISOString(), pierwszy.dataRozpoczecia);
  assert.throws(() => utworzEvent({ tytul: "   " }), TypeError);
});

test("NEWS trwale zachowuje wszystkie pola, w tym odrębne daty i tekst zawierający SQL", (t) => {
  const sciezka = przygotujSciezke(t);
  const przedUtworzeniem = Date.now();
  const news = utworzNews({
    tytul: "O'Reilly: '); DROP TABLE NEWS; --",
    dataPublikacji: "2020-01-02T12:30:00+02:00",
    autor: "O'Reilly",
    zrodlo: "Testowe źródło",
    url: "https://example.com/news?quote='",
  });
  assert.equal(news.dataPublikacji, "2020-01-02T10:30:00.000Z");
  assert.ok(Date.parse(news.dataPobrania) >= przedUtworzeniem);
  assert.ok(Date.parse(news.dataPobrania) <= Date.now());
  assert.notEqual(news.dataPublikacji, news.dataPobrania);

  const baza = otworzBazeEventow(sciezka);
  try {
    assert.deepEqual(baza.pobierzNewsy(), []);
    baza.zapiszNews(news);
    assert.throws(() => baza.zapiszNews(news), /UNIQUE constraint failed/);
  } finally {
    baza.zamknij();
  }

  const ponownie = otworzBazeEventow(sciezka);
  try {
    assert.deepEqual(ponownie.pobierzNewsy(), [news]);
  } finally {
    ponownie.zamknij();
  }
});

test("wiele NEWS-ów w EVENT i wiele EVENT-ów NEWS-a pozostają po ponownym otwarciu", (t) => {
  const sciezka = przygotujSciezke(t);
  const eventA = utworzEvent({ tytul: "Wydarzenie A" });
  const eventB = utworzEvent({ tytul: "Wydarzenie B" });
  const eventC = utworzEvent({ tytul: "Bez powiązań" });
  const newsA = utworzNews({ tytul: "News A", url: "https://example.com/a" });
  const newsB = utworzNews({ tytul: "News B", url: "https://example.com/b" });
  const newsC = utworzNews({ tytul: "Bez powiązań", url: "https://example.com/c" });
  const poId = (rekordy) => rekordy.map((rekord) => rekord.id).sort();
  function sprawdzPowiazania(baza) {
    assert.deepEqual(poId(baza.pobierzNewsyEventu(eventA.id)), poId([newsA, newsB]));
    assert.deepEqual(poId(baza.pobierzEventyNewsa(newsA.id)), poId([eventA, eventB]));
    assert.deepEqual(baza.pobierzNewsyEventu(eventB.id), [newsA]);
    assert.deepEqual(baza.pobierzEventyNewsa(newsB.id), [eventA]);
    assert.deepEqual(baza.pobierzNewsyEventu(eventC.id), []);
    assert.deepEqual(baza.pobierzEventyNewsa(newsC.id), []);
    assert.deepEqual(baza.pobierzNewsyEventu("' OR 1=1 --"), []);
    assert.deepEqual(baza.pobierzEventyNewsa("' OR 1=1 --"), []);
  }

  const baza = otworzBazeEventow(sciezka);
  try {
    for (const event of [eventA, eventB, eventC]) baza.zapiszEvent(event);
    for (const news of [newsA, newsB, newsC]) baza.zapiszNews(news);
    baza.powiazNewsZEventem(newsA.id, eventA.id);
    baza.powiazNewsZEventem(newsB.id, eventA.id);
    baza.powiazNewsZEventem(newsA.id, eventB.id);
    sprawdzPowiazania(baza);
  } finally {
    baza.zamknij();
  }

  const ponownie = otworzBazeEventow(sciezka);
  try {
    sprawdzPowiazania(ponownie);
    assert.throws(() => ponownie.powiazNewsZEventem(newsA.id, eventA.id), /UNIQUE constraint failed/);
    sprawdzPowiazania(ponownie);
  } finally {
    ponownie.zamknij();
  }
});

test("klucze obce blokują powiązania z nieistniejącym NEWS-em lub EVENT-em", (t) => {
  const sciezka = przygotujSciezke(t);
  const event = utworzEvent({ tytul: "Wydarzenie" });
  const news = utworzNews({ tytul: "News", url: "https://example.com/news" });
  const baza = otworzBazeEventow(sciezka);
  try {
    baza.zapiszEvent(event);
    baza.zapiszNews(news);
    assert.throws(() => baza.powiazNewsZEventem("brak", event.id), /FOREIGN KEY constraint failed/);
    assert.throws(() => baza.powiazNewsZEventem(news.id, "brak"), /FOREIGN KEY constraint failed/);
    assert.deepEqual(baza.pobierzNewsyEventu(event.id), []);
    assert.deepEqual(baza.pobierzEventyNewsa(news.id), []);
  } finally {
    baza.zamknij();
  }
  const ponownie = otworzBazeEventow(sciezka);
  try {
    assert.throws(() => ponownie.powiazNewsZEventem("brak", event.id), /FOREIGN KEY constraint failed/);
    assert.throws(() => ponownie.powiazNewsZEventem(news.id, "brak"), /FOREIGN KEY constraint failed/);
  } finally {
    ponownie.zamknij();
  }
});

test("brak daty publikacji pozostaje null, a nie datą pobrania", (t) => {
  const baza = otworzBazeEventow(przygotujSciezke(t));
  try {
    const news = utworzNews({ tytul: "News", url: "https://example.com/news" });
    const kolejny = utworzNews({ tytul: "Drugi", url: "https://example.com/news" });
    assert.notEqual(news.id, kolejny.id);
    assert.equal(news.dataPublikacji, null);
    assert.equal(news.autor, null);
    assert.equal(news.zrodlo, null);
    baza.zapiszNews(news);
    assert.deepEqual(baza.pobierzNewsy(), [news]);
  } finally {
    baza.zamknij();
  }
  assert.throws(() => utworzNews({ tytul: " ", url: "https://example.com" }), TypeError);
  assert.throws(() => utworzNews({ tytul: "News", url: " " }), TypeError);
  for (const dataPublikacji of ["niepoprawna", "2020-01-02T12:30:00"]) {
    assert.throws(() => utworzNews({ tytul: "News", url: "https://example.com", dataPublikacji }), TypeError);
  }
});

test("otwarcie starej bazy dodaje nowe tabele bez utraty istniejącego EVENT-u", (t) => {
  const sciezka = przygotujSciezke(t);
  const event = utworzEvent({ tytul: "Istniejący EVENT" });
  const staraBaza = new DatabaseSync(sciezka);
  try {
    staraBaza.exec(`
      CREATE TABLE EVENT (
        id TEXT PRIMARY KEY NOT NULL,
        tytul TEXT NOT NULL CHECK (length(trim(tytul)) > 0),
        status TEXT NOT NULL CHECK (length(trim(status)) > 0),
        dataRozpoczecia TEXT NOT NULL,
        ostatniaAktualizacja TEXT NOT NULL,
        typWydarzenia TEXT NOT NULL CHECK (length(trim(typWydarzenia)) > 0)
      )
    `);
    staraBaza.prepare("INSERT INTO EVENT VALUES (?, ?, ?, ?, ?, ?)").run(
      event.id, event.tytul, event.status, event.dataRozpoczecia,
      event.ostatniaAktualizacja, event.typWydarzenia,
    );
  } finally {
    staraBaza.close();
  }
  const baza = otworzBazeEventow(sciezka);
  try {
    assert.deepEqual(baza.pobierzEventy(), [event]);
    const news = utworzNews({ tytul: "Nowy NEWS", url: "https://example.com/news" });
    baza.zapiszNews(news);
    baza.powiazNewsZEventem(news.id, event.id);
    assert.deepEqual(baza.pobierzNewsyEventu(event.id), [news]);
  } finally {
    baza.zamknij();
  }
});
