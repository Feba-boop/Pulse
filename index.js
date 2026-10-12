const { openDatabase } = require("./storage");

// Initialize persistent storage before running the news pipeline.
const database = openDatabase();
database.close();

async function fetchNews() {
  try {
    let response = await fetch(
      "https://api.currentsapi.services/v1/latest-news",
      {
        headers: {
          Authorization: process.env.CURRENTS_API_KEY,
        },
      },
    );

    if (!response.ok) {
      if (response.status === 401) {
        console.log("API key error");
      } else if (response.status === 404) {
        console.log("Endpoint not found");
      } else {
        console.log("Other API error");
      }
      return;
    }

    let data = await response.json();

    let mappedNews = data.news.map(function (news) {
      return {
        title: news.title,
        published: news.published,
        url: news.url,
        author: news.author,
        language: news.language,
        category: news.category,
      };
    });

    let completeNews = removeIncompleteNews(mappedNews);
    let uniqueNews = removeDuplicates(completeNews);

    let englishNews = filterByLanguage(uniqueNews, "en");
    let generalEnglishNews = filterByCategory(
      englishNews,
      "general",
    );

    let similarPairs = findSimilarNewsPairs(generalEnglishNews);

    console.log(similarPairs.length);

    for (let i = 0; i < similarPairs.length; i++) {
      let pair = similarPairs[i];

      console.log(pair.firstNews.title);
      console.log(pair.secondNews.title);
    }

    let sortedNews = sortByPublicationDate(similarPairs);
    let firstFive = limitNews(sortedNews, 5);

    console.log(firstFive);
  } catch (error) {
    console.log(error);
  }
}

function filterByLanguage(newsItems, language) {
  return newsItems.filter(function (news) {
    return news.language === language;
  });
}

function filterByCategory(newsItems, category) {
  return newsItems.filter(function (news) {
    return news.category.includes(category);
  });
}

function sortByPublicationDate(newsItems) {
  return newsItems.sort(function (a, b) {
    return new Date(b.published) - new Date(a.published);
  });
}

function limitNews(newsItems, limit) {
  return newsItems.slice(0, limit);
}

function removeIncompleteNews(newsItems) {
  return newsItems.filter(function (news) {
    return (
      news.title &&
      news.title.trim() !== "" &&
      news.url &&
      news.url.trim() !== ""
    );
  });
}

function removeDuplicates(newsItems) {
  return newsItems.filter(function (news, index) {
    return (
      index ===
      newsItems.findIndex(function (otherNews) {
        return otherNews.url === news.url;
      })
    );
  });
}

function calculateTitleSimilarity(titleA, titleB) {
  let wordsA = new Set(titleA.toLowerCase().trim().split(" "));
  let wordsB = new Set(titleB.toLowerCase().trim().split(" "));

  let sharedWords = [...wordsA].filter(function (word) {
    return wordsB.has(word);
  });

  let allWords = new Set([...wordsA, ...wordsB]);

  return sharedWords.length / allWords.size;
}

function areNewsSimilar(newsA, newsB) {
  let similarity = calculateTitleSimilarity(newsA.title, newsB.title);

  return similarity >= 0.5;
}

function findSimilarNews(newsItems, targetNews) {
  return newsItems.filter(function (news) {
    return news !== targetNews && areNewsSimilar(news, targetNews);
  });
}

function findSimilarNewsPairs(newsItems) {
  let similarPairs = [];

  for (let i = 0; i < newsItems.length; i++) {
    for (let j = i + 1; j < newsItems.length; j++) {
      let newsA = newsItems[i];
      let newsB = newsItems[j];

      let similarity = calculateTitleSimilarity(newsA.title, newsB.title);

      console.log(newsA.title, newsB.title, similarity);
      if (areNewsSimilar(newsA, newsB)) {
        console.log(newsA.title);
        console.log(newsB.title);

        let pair = {
          firstNews: newsA,
          secondNews: newsB,
        };

        similarPairs.push(pair);
      }
    }
  }
  return similarPairs;
}

fetchNews();
