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

function otworzBazeEventow(sciezka = domyslnaSciezkaBazy) {
  const pelnaSciezka = resolve(sciezka);
  mkdirSync(dirname(pelnaSciezka), { recursive: true });
  const baza = new DatabaseSync(pelnaSciezka);

  try {
    baza.exec(`
      CREATE TABLE IF NOT EXISTS EVENT (
        id TEXT PRIMARY KEY NOT NULL,
        tytul TEXT NOT NULL CHECK (length(trim(tytul)) > 0),
        status TEXT NOT NULL CHECK (length(trim(status)) > 0),
        dataRozpoczecia TEXT NOT NULL,
        ostatniaAktualizacja TEXT NOT NULL,
        typWydarzenia TEXT NOT NULL CHECK (length(trim(typWydarzenia)) > 0)
      )
    `);

    const zapis = baza.prepare(`
      INSERT INTO EVENT (id, tytul, status, dataRozpoczecia, ostatniaAktualizacja, typWydarzenia)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const odczyt = baza.prepare(`
      SELECT id, tytul, status, dataRozpoczecia, ostatniaAktualizacja, typWydarzenia
      FROM EVENT ORDER BY dataRozpoczecia, id
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
      zamknij() {
        baza.close();
      },
    };
  } catch (error) {
    baza.close();
    throw error;
  }
}

module.exports = { otworzBazeEventow, utworzEvent };
