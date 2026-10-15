function prepareAiInputs(database) {
  const articles = [];

  for (const news of database.getNewsItems()) {
    const version = database.getLatestNewsVersion(news.id);
    if (!version) continue;

    articles.push({
      newsId: news.id,
      source: news.source,
      title: version.title,
      publishedAt: version.publishedAt,
    });
  }

  return articles;
}

module.exports = { prepareAiInputs };
