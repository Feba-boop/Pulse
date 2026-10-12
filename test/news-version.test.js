const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { mkdtempSync, readdirSync, unlinkSync, rmdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { otworzBazeEventow, utworzEvent, utworzNews } = require("../baza-eventow");

function sciezkaTestowa(t) {
  const katalog = mkdtempSync(join(tmpdir(), "pulse-version-test-"));
  t.after(() => {
    for (const plik of readdirSync(katalog)) unlinkSync(join(katalog, plik));
    rmdirSync(katalog);
  });
  return join(katalog, "test.sqlite");
}

const artykul = { url: "https://example.com/a", tytul: "Pierwszy tytuł", autor: null,
  dataPublikacji: "2020-01-01T12:00:00Z", zrodlo: "Wydawca" };

test("pierwszy zapis tworzy NEWS i wersję; identyczne dane nie zmieniają stanu", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-07T10:00:00Z") });
  const baza = otworzBazeEventow(sciezkaTestowa(t));
  try {
    const news = baza.zapiszNews(utworzNews(artykul));
    const wersja = baza.pobierzNajnowszaWersjeNewsa(news.id);
    assert.deepEqual(baza.pobierzNewsy(), [news]);
    assert.deepEqual(baza.pobierzWersjeNewsa(news.id), [wersja]);
    assert.equal(news.dataPobrania, "2026-10-07T10:00:00.000Z");
    assert.equal(wersja.dataWersji, news.dataPobrania);
    assert.equal(wersja.dataPublikacji, "2020-01-01T12:00:00.000Z");
    t.mock.timers.tick(1000);
    assert.deepEqual(baza.zapiszNews(artykul), news);
    assert.deepEqual(baza.pobierzWersjeNewsa(news.id), [wersja]);
    assert.deepEqual(baza.znajdzNewsPoUrl(artykul.url), news);
    assert.deepEqual(baza.pobierzNews(news.id), news);
    assert.equal(baza.pobierzNews("brak"), null);
    assert.equal(baza.znajdzNewsPoUrl("brak"), null);
    assert.equal(baza.pobierzNajnowszaWersjeNewsa("brak"), null);
    assert.deepEqual(baza.pobierzWersjeNewsa("brak"), []);
  } finally { baza.zamknij(); }
});

test("zmiany tytułu, autora i daty tworzą kolejne wersje, zachowane po otwarciu", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-07T10:00:00Z") });
  const sciezka = sciezkaTestowa(t);
  let baza = otworzBazeEventow(sciezka);
  let news, historia;
  try {
    news = baza.zapiszNews(artykul);
    const zmiany = [
      { ...artykul, tytul: "Nowy tytuł" },
      { ...artykul, tytul: "Nowy tytuł", autor: "John Smith" },
      { ...artykul, tytul: "Nowy tytuł", autor: "John Smith", dataPublikacji: null },
      artykul, // Powrót do starych wartości jest kolejną wersją, nie duplikatem historii.
    ];
    for (const dane of zmiany) {
      t.mock.timers.tick(1000);
      assert.deepEqual(baza.zapiszNews(dane), news);
    }
    historia = baza.pobierzWersjeNewsa(news.id);
    assert.equal(historia.length, 5);
    assert.equal(new Set(historia.map((w) => w.id)).size, 5);
    assert.deepEqual(historia.map((w) => w.tytul),
      [artykul.tytul, "Nowy tytuł", "Nowy tytuł", "Nowy tytuł", artykul.tytul]);
    assert.deepEqual(historia.map((w) => w.autor), [null, null, "John Smith", "John Smith", null]);
    assert.deepEqual(historia.map((w) => w.dataPublikacji),
      ["2020-01-01T12:00:00.000Z", "2020-01-01T12:00:00.000Z", "2020-01-01T12:00:00.000Z", null, "2020-01-01T12:00:00.000Z"]);
    assert.deepEqual(historia.map((w) => w.dataWersji), [0, 1, 2, 3, 4].map((s) => `2026-10-07T10:00:0${s}.000Z`));
    assert.deepEqual(baza.pobierzNajnowszaWersjeNewsa(news.id), historia[4]);
  } finally { baza.zamknij(); }
  baza = otworzBazeEventow(sciezka);
  try {
    assert.deepEqual(baza.pobierzNewsy(), [news]);
    assert.deepEqual(baza.pobierzWersjeNewsa(news.id), historia);
    baza.zapiszNews(artykul);
    assert.deepEqual(baza.pobierzWersjeNewsa(news.id), historia);
  } finally { baza.zamknij(); }
});

test("wersje w tej samej milisekundzie mają stabilną kolejność dodania", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1700000000000 });
  const baza = otworzBazeEventow(sciezkaTestowa(t));
  try {
    const news = baza.zapiszNews(artykul);
    baza.zapiszNews({ ...artykul, tytul: "Drugi" });
    baza.zapiszNews({ ...artykul, tytul: "Trzeci" });
    baza.zapiszNews({ ...artykul, tytul: "Trzeci" });
    assert.deepEqual(baza.pobierzWersjeNewsa(news.id).map((w) => w.tytul), [artykul.tytul, "Drugi", "Trzeci"]);
    assert.equal(baza.pobierzNajnowszaWersjeNewsa(news.id).tytul, "Trzeci");
  } finally { baza.zamknij(); }
});

test("URL nie jest normalizowany; źródło i pierwszy czas pozostają stałe", (t) => {
  const baza = otworzBazeEventow(sciezkaTestowa(t));
  try {
    const news = baza.zapiszNews(artykul);
    assert.deepEqual(baza.zapiszNews({ ...artykul, zrodlo: "Inne" }), news);
    assert.equal(baza.pobierzWersjeNewsa(news.id).length, 1);
    for (const url of [artykul.url + "/", " " + artykul.url, "https://EXAMPLE.com/a"]) {
      assert.equal(baza.zapiszNews({ ...artykul, url }).url, url);
    }
    assert.equal(baza.pobierzNewsy().length, 4);
  } finally { baza.zamknij(); }
});

test("UNIQUE URL, klucze obce i atomowy zapis są wymuszane w SQLite", (t) => {
  const sciezka = sciezkaTestowa(t);
  const baza = otworzBazeEventow(sciezka);
  const sql = new DatabaseSync(sciezka);
  try {
    sql.exec("PRAGMA foreign_keys = ON");
    const news = baza.zapiszNews(artykul);
    assert.throws(() => sql.prepare("INSERT INTO NEWS VALUES (?, ?, ?, ?)").run(
      "inne-id", news.url, news.zrodlo, news.dataPobrania), /UNIQUE constraint failed/);
    assert.throws(() => sql.prepare("INSERT INTO NEWS_VERSION VALUES (?, ?, ?, ?, ?, ?)").run(
      "wersja", "nieistniejacy", "Tytuł", null, news.dataPobrania, null), /FOREIGN KEY constraint failed/);
    sql.exec(`CREATE TRIGGER odrzuc_wersje BEFORE INSERT ON NEWS_VERSION
      BEGIN SELECT RAISE(ABORT, 'testowy blad zapisu'); END`);
    assert.throws(() => baza.zapiszNews({ ...artykul, url: "https://example.com/new" }), /testowy blad/);
    assert.equal(baza.znajdzNewsPoUrl("https://example.com/new"), null);
    assert.equal(baza.pobierzNewsy().length, 1);
  } finally { sql.close(); baza.zamknij(); }
});

test("relacje wiele-do-wielu pozostają po dodaniu wersji i ponownym otwarciu", (t) => {
  const sciezka = sciezkaTestowa(t);
  let baza = otworzBazeEventow(sciezka);
  const eventA = utworzEvent({ tytul: "A" });
  const eventB = utworzEvent({ tytul: "B" });
  let newsA, newsB;
  try {
    baza.zapiszEvent(eventA); baza.zapiszEvent(eventB);
    newsA = baza.zapiszNews(artykul);
    newsB = baza.zapiszNews({ ...artykul, url: "https://example.com/b" });
    baza.powiazNewsZEventem(newsA.id, eventA.id);
    baza.powiazNewsZEventem(newsA.id, eventB.id);
    baza.powiazNewsZEventem(newsB.id, eventA.id);
    baza.zapiszNews({ ...artykul, tytul: "Aktualizacja" });
  } finally { baza.zamknij(); }
  baza = otworzBazeEventow(sciezka);
  try {
    assert.deepEqual(baza.pobierzNewsyEventu(eventA.id).map((n) => n.id).sort(), [newsA.id, newsB.id].sort());
    assert.deepEqual(baza.pobierzEventyNewsa(newsA.id).map((e) => e.id).sort(), [eventA.id, eventB.id].sort());
    assert.deepEqual(baza.pobierzNewsyEventu(eventB.id), [newsA]);
    assert.deepEqual(baza.pobierzEventyNewsa(newsB.id), [eventA]);
    assert.throws(() => baza.powiazNewsZEventem(newsA.id, eventA.id), /UNIQUE constraint failed/);
    assert.throws(() => baza.powiazNewsZEventem("brak", eventA.id), /FOREIGN KEY constraint failed/);
    assert.throws(() => baza.powiazNewsZEventem(newsA.id, "brak"), /FOREIGN KEY constraint failed/);
    assert.deepEqual(baza.pobierzNewsyEventu("' OR 1=1 --"), []);
    assert.deepEqual(baza.pobierzEventyNewsa("brak"), []);
  } finally { baza.zamknij(); }
});

test("null i tekst SQL są zachowane, niepoprawne dane odrzucane", (t) => {
  const baza = otworzBazeEventow(sciezkaTestowa(t));
  try {
    const tytul = "O'Reilly: '); DROP TABLE NEWS; --";
    const news = baza.zapiszNews({ tytul, url: "https://example.com/?q='" });
    const wersja = baza.pobierzNajnowszaWersjeNewsa(news.id);
    assert.equal(wersja.tytul, tytul);
    assert.equal(wersja.dataPublikacji, null);
    assert.equal(wersja.autor, null);
    assert.equal(news.zrodlo, null);
    for (const dane of [{ ...artykul, tytul: " " }, { ...artykul, url: " " },
      { ...artykul, dataPublikacji: "niepoprawna" }, { ...artykul, dataPublikacji: "2020-01-01T12:00:00" }]) {
      assert.throws(() => baza.zapiszNews(dane), TypeError);
    }
    assert.equal(baza.pobierzNewsy().length, 1);
  } finally { baza.zamknij(); }
});

function staraBaza(sciezka, duplikat = false) {
  const sql = new DatabaseSync(sciezka);
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
      "news", "Stary tytuł", "2019-12-31T12:00:00Z", "2020-01-01T12:00:00Z", "Autor", "Źródło", artykul.url);
    sql.prepare("INSERT INTO EVENT_NEWS VALUES (?, ?)").run("event", "news");
    if (duplikat) {
      sql.prepare("INSERT INTO NEWS VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        "news2", "Inny tytuł", null, "2020-01-02T12:00:00Z", null, null, artykul.url);
      sql.prepare("INSERT INTO EVENT_NEWS VALUES (?, ?)").run("event", "news2");
    }
    return {
      newsy: sql.prepare("SELECT * FROM NEWS").all().map((n) => ({ ...n })),
      eventy: sql.prepare("SELECT * FROM EVENT").all().map((e) => ({ ...e })),
      relacje: sql.prepare("SELECT * FROM EVENT_NEWS").all().map((r) => ({ ...r })),
    };
  } finally { sql.close(); }
}

test("migracja zachowuje stare dane i relacje; ponowne otwarcie jest idempotentne", (t) => {
  const sciezka = sciezkaTestowa(t);
  const stare = staraBaza(sciezka);
  let wersja;
  for (let i = 0; i < 2; i++) {
    const baza = otworzBazeEventow(sciezka);
    try {
      const { id, url, zrodlo, dataPobrania, tytul, autor, dataPublikacji } = stare.newsy[0];
      const news = { id, url, zrodlo, dataPobrania };
      assert.deepEqual(baza.pobierzNewsy(), [news]);
      assert.deepEqual(baza.pobierzEventy(), stare.eventy);
      assert.deepEqual(baza.pobierzNewsyEventu("event"), [news]);
      assert.deepEqual(baza.pobierzEventyNewsa("news"), stare.eventy);
      const historia = baza.pobierzWersjeNewsa("news");
      assert.equal(historia.length, 1);
      if (!wersja) wersja = historia[0];
      assert.deepEqual(historia, [wersja]);
      assert.deepEqual(wersja, { id: wersja.id, newsId: id, tytul, autor, dataPublikacji, dataWersji: dataPobrania });
      assert.deepEqual(baza.zapiszNews({ url, zrodlo, tytul, autor,
        dataPublikacji: "2019-12-31T13:00:00+01:00" }), news);
      assert.deepEqual(baza.pobierzWersjeNewsa(id), [wersja]);
    } finally { baza.zamknij(); }
  }
});

test("różne zapisy tej samej chwili nie tworzą wersji, rzeczywista zmiana tworzy", (t) => {
  const baza = otworzBazeEventow(sciezkaTestowa(t));
  try {
    const news = baza.zapiszNews({ ...artykul, dataPublikacji: "2020-01-01T14:00:00+02:00" });
    const pierwsza = baza.pobierzNajnowszaWersjeNewsa(news.id);
    assert.equal(pierwsza.dataPublikacji, "2020-01-01T12:00:00.000Z");
    for (const dataPublikacji of ["2020-01-01T12:00:00Z", "2020-01-01T12:00:00.000Z",
      "2020-01-01T07:00:00-05:00", "2020-01-01T14:00:00+0200"]) {
      assert.deepEqual(baza.zapiszNews({ ...artykul, dataPublikacji }), news);
      assert.deepEqual(baza.pobierzWersjeNewsa(news.id), [pierwsza]);
    }
    baza.zapiszNews({ ...artykul, dataPublikacji: "2020-01-01T12:00:00.001Z" });
    assert.equal(baza.pobierzWersjeNewsa(news.id).length, 2);
    baza.zapiszNews({ ...artykul, dataPublikacji: null });
    baza.zapiszNews({ ...artykul, dataPublikacji: null });
    assert.equal(baza.pobierzWersjeNewsa(news.id).length, 3);
    assert.equal(baza.pobierzNajnowszaWersjeNewsa(news.id).dataPublikacji, null);
  } finally { baza.zamknij(); }
});

test("historyczne NEWS_VERSION są porównywane po normalizacji bez zmiany historii", (t) => {
  const sciezka = sciezkaTestowa(t);
  let baza = otworzBazeEventow(sciezka);
  let news;
  try { news = baza.zapiszNews(artykul); } finally { baza.zamknij(); }
  const sql = new DatabaseSync(sciezka);
  try {
    sql.prepare("UPDATE NEWS_VERSION SET dataPublikacji = ? WHERE newsId = ?")
      .run("2020-01-01T14:00:00+02:00", news.id);
  } finally { sql.close(); }
  for (let i = 0; i < 2; i++) {
    baza = otworzBazeEventow(sciezka);
    try {
      const historia = baza.pobierzWersjeNewsa(news.id);
      assert.equal(historia[0].dataPublikacji, "2020-01-01T14:00:00+02:00");
      assert.deepEqual(baza.zapiszNews(artykul), news);
      assert.deepEqual(baza.pobierzWersjeNewsa(news.id), historia);
    } finally { baza.zamknij(); }
  }
});

test("migracja z duplikatami URL cofa zmiany i nie usuwa żadnych danych", (t) => {
  const sciezka = sciezkaTestowa(t);
  const stare = staraBaza(sciezka, true);
  for (let i = 0; i < 2; i++) {
    assert.throws(() => otworzBazeEventow(sciezka), /Migracja NEWS przerwana: zduplikowany URL/);
    const sql = new DatabaseSync(sciezka);
    try {
      assert.deepEqual(sql.prepare("SELECT * FROM NEWS").all().map((n) => ({ ...n })), stare.newsy);
      assert.deepEqual(sql.prepare("SELECT * FROM EVENT").all().map((e) => ({ ...e })), stare.eventy);
      assert.deepEqual(sql.prepare("SELECT * FROM EVENT_NEWS").all().map((r) => ({ ...r })), stare.relacje);
      assert.equal(sql.prepare("SELECT name FROM sqlite_master WHERE name = 'NEWS_VERSION'").get(), undefined);
    } finally { sql.close(); }
  }
});
