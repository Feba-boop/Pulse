const { openDatabase } = require("./storage");
const { prepareAiInputs } = require("./prepare-ai-inputs");

// Legacy keyword example, independent of the AI classification module.
function classifyNews(title) {
  const text = title.toLowerCase();

  if (text.includes("stock")) {
    return "finance";
  }

  if (text.includes("nato")) {
    return "geopolitics";
  }

  return "other";
}

function main() {
  const database = openDatabase();
  try {
    const aiInputs = prepareAiInputs(database);
    console.log("Prepared articles:", aiInputs.length);
    console.log(aiInputs.slice(0, 3));
  } finally {
    database.close();
  }
}

if (require.main === module) main();

module.exports = { classifyNews, prepareAiInputs };
