const { openDatabase } = require("./storage");
const { prepareAiInputs } = require("./prepare-ai-inputs");
const { createOllamaClient } = require("./ollama-client");
const { classifyNewsWithAI } = require("./classify-news");

async function runAiDemo({ databasePath, client, openDatabaseFn = openDatabase } = {}) {
  const database = openDatabaseFn(databasePath);
  try {
    const articles = prepareAiInputs(database).slice(0, 3);
    if (articles.length === 0) {
      console.log("No articles with saved versions. Fetch and save news before running this demo.");
      return;
    }
    const aiClient = client ?? createOllamaClient();
    console.log("Tentative classification based on titles only; full articles have not been read or verified.");
    for (const article of articles) {
      const result = await classifyNewsWithAI(article, aiClient);
      console.log(JSON.stringify(result, null, 2));
    }
  } finally {
    database.close();
  }
}

if (require.main === module) {
  runAiDemo({ databasePath: process.argv[2] }).catch((error) => {
    console.error(`AI demo failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { runAiDemo };
