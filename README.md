# Pulse

Pulse is a Node.js news bot that fetches current news from an external API and displays selected information in the console.

## Features

- Fetches latest news from the Currents API
- Handles basic API errors
- Converts API responses into simplified news objects
- Removes incomplete news without a title or URL
- Removes exact duplicates based on URL
- Filters news by language
- Filters news by category
- Sorts news by publication date
- Limits the number of displayed results
- Calculates title similarity using Jaccard similarity
- Compares unique pairs of news articles
- Detects potentially similar articles using a test similarity threshold

## Planned Development

Pulse is currently an early prototype.

Future development will include:

- Connecting the news-fetching pipeline to persistent storage
- Multiple news sources
- Grouping related articles into events
- Comparing new articles with existing events
- Improved semantic similarity detection
- AI-based summarization and classification
- Event timelines
- Analysis of possible relationships between events
- Backend API and frontend interface

## Setup

1. Create a `.env` file in the main project folder.
2. Add your API key to the `.env` file.
3. Add `CURRENTS_API_KEY=your_api_key` to your `.env` file.
4. Run the application:

```bash
node --env-file=.env index.js
```

## Trwałe EVENT-y — pierwszy etap

Warstwa SQLite korzysta z wbudowanego `node:sqlite`, bez zależności npm.
Sprawdzono na Node.js **24.19.0**. Nie jest potrzebny osobny serwer bazy danych.

Przy starcie `index.js` powstają katalog `data`, baza `data/pulse.sqlite` i tabele
`EVENT`, `NEWS`, `NEWS_VERSION` oraz `EVENT_NEWS`, jeśli jeszcze nie istnieją. Ścieżka bazy jest liczona względem modułu,
nie względem katalogu, z którego uruchomiono polecenie. Dane są wyłączone z Git.

Moduł `baza-eventow.js` udostępnia:

- `utworzEvent({ tytul, status, typWydarzenia })` — tworzy obiekt z UUID.
  Domyślny status to `aktywny`, a typ to `nieokreslony`.
- `otworzBazeEventow(sciezka?)` — otwiera bazę i tworzy tabelę, jeśli jej nie ma.
- Metody otwartej bazy: `zapiszEvent(event)`, `pobierzEventy()` i `zamknij()`.
  Po zakończeniu pracy należy wywołać `zamknij()`, najlepiej w `finally`.

EVENT zawiera `id`, `tytul`, `status`, `dataRozpoczecia`,
`ostatniaAktualizacja` i `typWydarzenia`. Obie daty przy tworzeniu mają tę samą
wartość w formacie ISO 8601 UTC: jest to czas utworzenia EVENT-u w Pulse,
nie ustalona data początku wydarzenia w świecie. Status i typ są na razie
niepustymi tekstami, bez zamkniętego słownika. Zapis dodaje rekord; ponowne
użycie tego samego ID zgłasza błąd, nie nadpisuje danych.

### Sprawdzenie trwałości bez API newsów

Uruchom w katalogu projektu:

```bash
node demo-event.js
```

Za pierwszym razem zobaczysz komunikat o zapisie i EVENT z ID
`pulse-demo-event-v1`. Po zakończeniu procesu uruchom to samo polecenie ponownie:

```bash
node demo-event.js
```

Zobaczysz komunikat o odczycie wcześniejszego EVENT-u. ID i daty pozostaną
identyczne, a demonstracja nie doda kolejnej kopii. Można podać osobną ścieżkę,
np. `node demo-event.js data/demo.sqlite`, i dwukrotnie użyć tego polecenia.
Demonstracja nie wymaga `.env`; można ją później usunąć bez zmian w pipeline.
Nie usuwaj pliku bazy, jeśli chcesz zachować zapisane dane.

Testy uruchamia się poleceniem:

```bash
node --test
```

Testy używają oddzielnych baz tymczasowych, w tym dwóch osobnych procesów Node.js.
Nie zapisują danych demonstracyjnych do domyślnej bazy aplikacji.

Ten etap nie grupuje newsów automatycznie ani nie tworzy historii zmian.
Pipeline newsów pozostaje bez zmian. Istniejące problemy tego pipeline'u:
końcowa pętla testowa używa niezdefiniowanego `para`, a `sortujPoDacie` otrzymuje
pary bez pola `published`. Nie naprawiono ich w ramach obsługi SQLite.

## NEWS i historia NEWS_VERSION

NEWS to stała tożsamość artykułu: `id`, `url`, `zrodlo`, `dataPobrania`.
Dokładnie taki sam URL oznacza ten sam NEWS. Unikalny indeks SQLite wymusza
`UNIQUE(url)`. URL nie jest normalizowany, nawet przez przycinanie spacji.

NEWS_VERSION zawiera `id`, `newsId`, `tytul`, `dataPublikacji`, `dataWersji`, `autor`.
Przy każdym przekazaniu danych porównujemy dokładne wartości tytułu, daty publikacji
i autora z najnowszą wersją. Zmiana dowolnej wartości, również `null` na tekst,
tworzy nową wersję. Powrót do wcześniejszych wartości też tworzy wersję.
Identyczne dane nie tworzą nowego rekordu. Zmiana samego źródła nie tworzy wersji:
źródło zapisane przy pierwszym pojawieniu się URL pozostaje niezmienne.

`dataPobrania` to moment pierwszego przyjęcia artykułu przez `zapiszNews()`.
Pierwsza wersja ma identyczne `dataWersji`. Kolejne wersje otrzymują czas ich
wykrycia przy zapisie, niezależny od daty publikacji. Dane należy przekazywać
bezpośrednio po otrzymaniu przez Pulse. Obie daty systemowe są w ISO UTC i nie są
nadpisywane. Zegar komputera powinien być poprawnie ustawiony.

Brak autora, źródła lub daty publikacji oznacza `null`. Data publikacji wymaga
poprawnej daty z jawną strefą czasową. Nowe daty są normalizowane do ISO 8601 UTC
(np. `2020-01-01T12:00:00.000Z`). Historyczne daty z poprawną strefą są normalizowane
w pamięci przy porównywaniu, więc inny zapis tej samej chwili nie tworzy wersji.
Istniejące rekordy historii nie są nadpisywane. Historycznych dat niepoprawnych
lub bez jawnej strefy nie interpretujemy jako czasu lokalnego. Tytuł jest
zachowywany dokładnie, ale tytuł i URL nie mogą być puste.

### API

Pozostaje `otworzBazeEventow(sciezka?)`, API EVENT i ręczne wiązanie NEWS–EVENT.
`utworzNews(dane)` opcjonalnie sprawdza i przygotowuje dane artykułu; już nie
nadaje ID ani czasu pobrania. Można przekazać dane bezpośrednio do `zapiszNews()`.

| Metoda bazy | Wynik |
| --- | --- |
| `zapiszNews({ url, tytul, dataPublikacji?, autor?, zrodlo? })` | Tworzy NEWS i pierwszą wersję lub warunkowo dopisuje wersję; zwraca stały rekord NEWS. |
| `znajdzNewsPoUrl(url)` | NEWS lub `null`. |
| `pobierzNews(id)` | NEWS lub `null`. |
| `pobierzNewsy()` | Lista rekordów tożsamości NEWS. |
| `pobierzWersjeNewsa(newsId)` | Wersje chronologicznie; przy identycznym czasie według kolejności dodania. |
| `pobierzNajnowszaWersjeNewsa(newsId)` | Ostatnia wersja lub `null`. |
| `powiazNewsZEventem(newsId, eventId)` | Łączy istniejące rekordy, odrzuca duplikaty. |
| `pobierzNewsyEventu(eventId)` | Tożsamości NEWS związane z EVENT-em, bez pól wersji. |
| `pobierzEventyNewsa(newsId)` | EVENT-y związane z NEWS-em. |

Odczyty list bez wyników zwracają `[]`. Do powiązań używaj ID z wyniku
`zapiszNews()`. Wywołanie nie przyjmuje własnego ID ani własnych dat systemowych.
Zapis jest atomowy (`BEGIN IMMEDIATE`): błąd wersji wycofuje również nowy NEWS.
Blokada zapisu obejmuje odczyt ostatniej wersji i decyzję o dopisaniu, żeby dwa
połączenia nie podejmowały tej decyzji na tym samym nieaktualnym stanie.
Klucze obce są włączone na każdym połączeniu. Dane SQL są parametryzowane.

```js
const { otworzBazeEventow } = require("./baza-eventow");
const baza = otworzBazeEventow();
try {
  const dane = { url: "https://example.com/news", tytul: "Pierwszy tytuł" };
  const news = baza.zapiszNews(dane);
  baza.zapiszNews(dane); // Bez nowej wersji.
  baza.zapiszNews({ ...dane, tytul: "Zaktualizowany tytuł" });
  console.log(baza.pobierzWersjeNewsa(news.id));
} finally {
  baza.zamknij();
}
```

### Migracja istniejącej bazy

`schemat-bazy.js` uruchamia migrację przy otwarciu bazy, w jednej transakcji.
Wykrywa stary schemat po kolumnie `NEWS.tytul`. Dla każdego starego NEWS-a dodaje
pierwszą wersję z dotychczasowym tytułem, autorem i datą publikacji. Jako
`dataWersji` przyjmuje zachowane `dataPobrania`: to jedyny zapisany wcześniej
moment obserwacji; migracja nie odtwarza nieznanej historii zmian.

Następnie usuwa z NEWS wyłącznie przeniesione kolumny (`ALTER TABLE DROP COLUMN`).
ID, URL, źródło, czas pobrania, EVENT-y i relacje pozostają na miejscu. Nie wyłącza
kluczy obcych. Sprawdza ich spójność przed zatwierdzeniem. Ponowne otwarcie nie
tworzy kopii wersji. Operacje te obsługuje SQLite w Node.js 24.19.0.

Zduplikowane URL-e przerywają migrację czytelnym błędem; cała transakcja jest
wycofywana. Nie usuwamy i nie scalamy danych. Rozstrzygnięcie duplikatów wymaga
osobnej decyzji. Po błędzie bazę można otworzyć ponownie bez utraty starego stanu.

Testy `node --test` używają wyłącznie baz tymczasowych. Nie uruchamiają migracji
na normalnej bazie Pulse. Mechanizm nie monitoruje URL-i i nie jest jeszcze
podłączony do pipeline'u pobierania newsów; `usunDuplikaty()` pozostaje bez zmian.
