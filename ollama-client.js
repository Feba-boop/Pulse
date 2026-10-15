function createOllamaClient({
  baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
  model = process.env.OLLAMA_MODEL,
  timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? 120000),
  fetchImpl = globalThis.fetch,
} = {}) {
  const server = new URL(baseUrl);
  if (!["http:", "https:"].includes(server.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(server.hostname) ||
      server.username || server.password || server.search || server.hash || server.pathname !== "/") {
    throw new Error("OLLAMA_BASE_URL must be a local HTTP server URL, for example http://127.0.0.1:11434.");
  }
  if (typeof model !== "string" || model.trim() === "") {
    throw new Error("Set OLLAMA_MODEL to the name of a locally installed Ollama model.");
  }
  if (model.endsWith(":cloud")) {
    throw new Error("Use a local Ollama model rather than a cloud model.");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) {
    throw new Error("OLLAMA_TIMEOUT_MS must be a positive integer no greater than 2147483647.");
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function.");
  }

  return {
    async generate({ prompt, system, format = "json" }) {
      const controller = new AbortController();
      // The timeout covers both the request and reading its response body.
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(new URL("/api/generate", server), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          redirect: "error",
          signal: controller.signal,
          body: JSON.stringify({ model, prompt, system, format, stream: false, options: { temperature: 0 } }),
        });
        if (!response.ok) {
          throw new Error(`Ollama HTTP ${response.status}. Check that the server is running and model "${model}" is installed.`);
        }

        let payload;
        try {
          payload = await response.json();
        } catch (error) {
          throw new Error("Ollama returned an invalid JSON response body.", { cause: error });
        }
        if (!payload || typeof payload !== "object" || payload.error ||
            payload.done !== true || typeof payload.response !== "string") {
          throw new Error("Ollama returned an incomplete or invalid generation response.");
        }
        return payload.response;
      } catch (error) {
        if (controller.signal.aborted) {
          throw new Error(`Ollama request timed out after ${timeoutMs} ms.`, { cause: error });
        }
        if (error instanceof TypeError) {
          throw new Error(`Could not connect to Ollama at ${server.origin}. Check the local server.`, { cause: error });
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

module.exports = { createOllamaClient };
