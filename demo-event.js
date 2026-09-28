// Samodzielna demonstracja: można usunąć ten plik bez zmiany pipeline'u newsów.
const { otworzBazeEventow, utworzEvent } = require("./baza-eventow");

// Opcjonalna ścieżka pozwala sprawdzić zapis w osobnej bazie testowej.
const baza = otworzBazeEventow(process.argv[2]);
const idDemonstracji = "pulse-demo-event-v1";

try {
  const zapisanyEvent = baza.pobierzEventy().find((event) => event.id === idDemonstracji);

  if (zapisanyEvent) {
    console.log("Odczytano EVENT zapisany podczas wcześniejszego uruchomienia.");
  } else {
    const event = utworzEvent({
      tytul: "Demonstracja trwałego EVENT-u Pulse",
      typWydarzenia: "demonstracja",
    });
    // Stałe ID dotyczy tylko demonstracji i zapobiega dopisywaniu kolejnych kopii.
    event.id = idDemonstracji;
    baza.zapiszEvent(event);
    console.log("Zapisano demonstracyjny EVENT w SQLite.");
  }

  console.log(JSON.stringify(baza.pobierzEventy(), null, 2));
} finally {
  baza.zamknij();
}
