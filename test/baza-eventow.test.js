const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, readdirSync, unlinkSync, rmdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const { otworzBazeEventow, utworzEvent } = require("../baza-eventow");

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
