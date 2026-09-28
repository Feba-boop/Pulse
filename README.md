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

- Persistent news storage in a database
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

Przy starcie `index.js` powstają katalog `data`, baza `data/pulse.sqlite` i tabela
`EVENT`, jeśli jeszcze nie istnieją. Ścieżka bazy jest liczona względem modułu,
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

Ten etap nie grupuje newsów automatycznie, nie tworzy tabeli newsów ani historii
zmian. Pipeline newsów pozostaje bez zmian. Istniejące problemy tego pipeline'u:
końcowa pętla testowa używa niezdefiniowanego `para`, a `sortujPoDacie` otrzymuje
pary bez pola `published`. Nie naprawiono ich w ramach obsługi SQLite.
