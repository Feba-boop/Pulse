# Local AI integration

Pulse is prepared to call a local Ollama model. No model or Ollama installation is
included. The existing Currents pipeline and SQLite schema are unchanged.

## Architecture

```text
SQLite -> prepareAiInputs(database) -> classifyNewsWithAI(article, client)
                                     -> Ollama client -> local /api/generate
```

- `prepare-ai-inputs.js` exports `prepareAiInputs(database)`. It returns the latest
  saved title, publication date, source, and news ID, skipping identities without
  a version. It does not own the connection or call AI.
- `ai-input.js` remains the preparation-only demo: `node ai-input.js`. Its existing
  keyword classification example is retained separately and is not used by AI.
- `ollama-client.js` exports `createOllamaClient(options?)`. Its `generate()` method
  uses native `fetch`, non-streaming responses, a JSON schema, and a timeout covering
  the request and response body. `fetchImpl` can be injected for offline testing.
- `classify-news.js` exports `classifyNewsWithAI(article, client)`. It supplies
  meaning-based classification instructions, parses JSON, and validates the result.
- `demo-ai.js` is a manual runner: it processes up to three articles sequentially
  and closes storage in `finally`, including when a request or validation fails.
  No classification results are saved to SQLite at this stage.

Importing these modules does not open storage or send requests. No agents, periodic
monitoring, automatic event assignment, or paid services are added.

## Result and limitations

The model must return exactly:

```json
{
  "categories": ["economy", "finance"],
  "marketRelevance": "medium",
  "summary": "A brief description of what the title reports.",
  "reasoning": "A brief classification justification based on limited evidence."
}
```

Allowed categories are `finance`, `economy`, `geopolitics`, `technology`, `politics`,
`cybersecurity`, `sports`, `entertainment`, and `other`. At least one is required;
duplicates are rejected. Relevance must be `low`, `medium`, or `high`. Summary and
reasoning must be non-empty strings, at most 600 characters each. Malformed JSON,
Markdown fences, missing/extra fields, and incorrect types are rejected.

The returned application result adds `newsId` and `analysisScope: "title-only"`.
Only the title and source/publication metadata are sent. The full article has not
been read or verified. The summary describes the title's claim; relevance is a
tentative assessment, not a verified financial analysis or trading instruction.
Schema validation checks shape and allowed values, not factual accuracy. Real
semantic quality must be evaluated with a running model.

## Future installation on Windows

These are instructions for later manual execution; setup was not performed as
part of this change.

1. Install Ollama using the [official Windows instructions](https://docs.ollama.com/windows).
2. Configure local-only mode by setting `OLLAMA_NO_CLOUD=1` for the Ollama server
   process and restarting it. See [Ollama's local-only configuration](https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features).
3. Download a local model. For example, [Llama 3.2](https://ollama.com/library/llama3.2)
   has a `3b` variant. This is a starter example, not a tested quality recommendation:

```powershell
ollama pull llama3.2:3b
ollama list
```

The download needs Internet access; article inference should use the installed
local model. The Ollama Windows application normally runs the server. If running
the CLI server manually instead, use a separate terminal:

```powershell
$env:OLLAMA_NO_CLOUD = "1"
ollama serve
```

Do not start another server if one is already listening on port 11434.

## Configuration and first analysis

In PowerShell, from the Pulse project directory:

```powershell
$env:OLLAMA_MODEL = "llama3.2:3b"
$env:OLLAMA_BASE_URL = "http://127.0.0.1:11434"
$env:OLLAMA_TIMEOUT_MS = "120000"
node demo-ai.js
```

`OLLAMA_MODEL` is required and must name an installed local model. The base URL and
timeout are optional with the defaults shown above. This client accepts loopback
server addresses only (`127.0.0.1`, `localhost`, or `[::1]`) and rejects redirects
and `:cloud` model names. Keep Ollama in local-only mode as described above.

Environment variables may instead be added manually to the existing ignored `.env`,
then loaded with `node --env-file=.env demo-ai.js`. No API key is needed for local
Ollama. The normal database is selected by default; an optional file path selects
another database: `node demo-ai.js data/demo.sqlite`.

Storage must contain at least one news identity with a saved version. If necessary,
run the existing fetcher yourself with `node --env-file=.env index.js` before analysis.
The demo prints a message and makes no AI request when there are no eligible articles.
It stops at the first failure, reports the error, closes storage, and exits with
status 1. There are no retries or automatic model downloads.

The API request uses `POST /api/generate`, `stream: false`, a schema in `format`,
and `temperature: 0`. See the official [generation API](https://docs.ollama.com/api/generate)
and [structured output documentation](https://docs.ollama.com/capabilities/structured-outputs).

## Verification

```powershell
node --test
```

Tests use temporary SQLite files, mock AI clients, and injected fetch functions.
They cover preparation, missing versions, JSON validation, HTTP/connection errors,
timeouts during requests and body reads, sequential demo limits, cleanup, and
side-effect-free imports. They make no requests to a real Ollama server and do not
write test data to the normal database.

Real installation, model loading, hardware performance, structured-output support
for the chosen model, and classification quality remain to be checked manually.
