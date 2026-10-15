# Pulse

Pulse is an early Node.js news intelligence prototype. It fetches current news
from Currents API, processes articles in memory, and provides persistent SQLite
storage for events, article identities, article versions, and manual event/news links.

## Setup

Verified with Node.js **24.19.0**. Storage uses built-in `node:sqlite`; no npm
dependencies or separate database server are required.

Create `.env` in the project root with `CURRENTS_API_KEY=your_api_key`, then run:

```bash
node --env-file=.env index.js
```

Startup initializes `data/pulse.sqlite` and any missing tables: `EVENT`, `NEWS`,
`NEWS_VERSION`, and `EVENT_NEWS`. The default path is relative to `storage.js`,
not the current working directory. The data directory is excluded from Git.

## News pipeline

The pipeline fetches latest news, handles basic API errors, maps response fields,
removes incomplete articles and exact URL duplicates, and filters English news
in the `general` category. It compares title pairs using Jaccard similarity with
a threshold of `0.5` and sorts and limits console output.

Title comparison lowercases and trims titles, splits on single spaces, and compares
unique word sets. Each distinct article pair is compared once. The existing sorting
limitation remains: `sortByPublicationDate()` receives pair objects without a
`published` field. The external request, response fields, filters, and similarity
algorithm retain their behavior. The pipeline is not yet connected to article
storage or automatic event grouping.

## Events

`createEvent({ title, status, eventType })` creates a UUID and properties `id`,
`title`, `status`, `startedAt`, `updatedAt`, and `eventType`. Both timestamps initially
contain the creation time in ISO UTC; they do not infer the real-world start time.
Status and type are non-empty strings without a fixed vocabulary. Existing defaults
`aktywny` and `nieokreslony` are intentionally retained as domain data. Saving an
existing event ID raises an error rather than overwriting it.

## News identities and versions

An identity contains `id`, `url`, `source`, and `firstSeenAt`. An exact URL identifies
one article and SQLite enforces uniqueness. URLs are not normalized, including
whitespace, capitalization, or trailing slashes.

A version contains `id`, `newsId`, `title`, `publishedAt`, `versionDetectedAt`, and
`author`. Saving data compares title, publication date, and author with the latest
version. Changes, including null-to-text transitions and returning to earlier
values, create versions. Identical data creates no version. Source changes alone
create no version; the first recorded source remains fixed.

`firstSeenAt` is assigned when `saveNews()` first accepts an article. The first
version has the same `versionDetectedAt`; subsequent versions receive their detection
time at save, independently of the publication time. Pass data immediately after
receiving it. System timestamps use ISO UTC and are not overwritten. The computer
clock should be correctly set.

Missing author, source, or publication date means `null`. Publication dates require
a valid timestamp with an explicit timezone and are normalized to ISO 8601 UTC,
such as `2020-01-01T12:00:00.000Z`. Historical dates with valid timezones are normalized
in memory for comparison without rewriting history. Equivalent timestamps do not
create extra versions. Invalid historical dates or dates without an explicit
timezone are left uninterpreted. Titles are preserved exactly; titles and URLs
cannot be empty.

## Storage API

Import `openDatabase`, `createEvent`, and `createNews` from `./storage`.
`openDatabase(path?)` initializes and opens storage. Always call `close()` after use,
preferably in `finally`. `createNews(articleData)` optionally validates and prepares
input; it assigns no ID or timestamps. Data can go directly to `saveNews()`.

| Database method | Result |
| --- | --- |
| `saveEvent(event)` | Inserts an event. |
| `getEvents()` | Returns saved events. |
| `saveNews({ url, title, publishedAt?, author?, source? })` | Creates an identity and first version or conditionally adds a version; returns the identity. |
| `findNewsByUrl(url)` | Returns an identity or `null`. |
| `getNews(id)` | Returns an identity or `null`. |
| `getNewsItems()` | Returns news identities. |
| `getNewsVersions(newsId)` | Returns versions chronologically; insertion order breaks timestamp ties. |
| `getLatestNewsVersion(newsId)` | Returns the latest version or `null`. |
| `linkNewsToEvent(newsId, eventId)` | Links existing records; duplicate links raise an error. |
| `getNewsForEvent(eventId)` | Returns linked identities without version fields. |
| `getEventsForNews(newsId)` | Returns linked events. |
| `close()` | Closes the connection. |

List queries with no results return `[]`. Use the ID returned by `saveNews()` for
links. The method assigns IDs and system timestamps itself. Identity and version
writes are atomic (`BEGIN IMMEDIATE`): failed version writes also roll back new
identities. The write lock covers reading the latest version and deciding whether
to add one. Foreign keys are enabled on every connection and SQL values are
parameterized. `EVENT_NEWS` has composite primary key `(eventId, newsId)` and foreign
keys. Missing records or duplicate links raise errors. An index on `newsId` supports
reverse lookups. Links do not change event timestamps or status; there is no
cascading deletion.

```js
const { openDatabase } = require("./storage");
const database = openDatabase();
try {
  const article = { url: "https://example.com/news", title: "Initial title" };
  const news = database.saveNews(article);
  database.saveNews(article); // No additional version.
  database.saveNews({ ...article, title: "Updated title" });
  console.log(database.getNewsVersions(news.id));
} finally {
  database.close();
}
```

## Existing database compatibility

English JavaScript properties are mapped through SQL aliases to unchanged columns:

| SQLite column | JavaScript property |
| --- | --- |
| `tytul` | `title` |
| `dataRozpoczecia` | `startedAt` |
| `ostatniaAktualizacja` | `updatedAt` |
| `typWydarzenia` | `eventType` |
| `zrodlo` | `source` |
| `dataPobrania` | `firstSeenAt` |
| `dataPublikacji` | `publishedAt` |
| `dataWersji` | `versionDetectedAt` |
| `autor` | `author` |

There is no schema migration for naming. JavaScript module paths and API names
have changed, so callers must use the new names and properties.

The existing legacy migration in `database-schema.js` runs in one transaction.
It detects the old schema through `NEWS.tytul`, creates the first version from each
old article, and uses its preserved first-seen time as the initial detection time.
It cannot reconstruct unknown article edits.

The migration drops only the migrated columns with `ALTER TABLE DROP COLUMN`.
IDs, URLs, sources, first-seen times, events, and links remain intact. Foreign keys
stay enabled and are checked before commit. Reopening does not duplicate versions.
Duplicate legacy URLs abort migration with a clear error and roll back all changes;
no data is silently deleted or merged. Resolving duplicates requires a separate decision.

## Persistence demonstration and tests

Run the standalone demo twice:

```bash
node demo-event.js
node demo-event.js
```

The first run saves `pulse-demo-event-v1`; the second loads it with unchanged ID
and timestamps. Existing demo labels are preserved as data. An optional path such
as `node demo-event.js data/demo.sqlite` selects a separate database. The demo needs
no `.env` and can be removed independently. Keep the database file to retain data.

```bash
node --test
```

Tests use temporary databases, including a two-process persistence check, without
writing test records to normal storage. Coverage includes versions, historical date
normalization, uniqueness, foreign keys, atomic rollback, many-to-many links, legacy
migration, rollback, and idempotence. Legacy fixtures include Polish article data
to verify preservation through the English API.

## Planned development

Local AI integration scaffolding and manual setup instructions are available in
[docs/AI_SETUP.md](docs/AI_SETUP.md). Run `node ai-input.js` to inspect prepared
inputs, or configure a local model and run `node demo-ai.js` for title-only
classification. These scripts are separate from the normal fetcher.

- Connect the fetching pipeline to storage.
- Support multiple news sources.
- Group articles into events and compare new articles with existing events.
- Improve semantic similarity; add AI summarization and classification.
- Build event timelines and analyze relationships between events.
- Add a backend API and frontend interface.

There is no automatic URL monitoring, semantic change analysis, or trading and
backtesting logic at this stage.
