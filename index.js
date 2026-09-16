async function pobierzNewsy() {
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
        console.log("Problem z kluczem API");
      } else if (response.status === 404) {
        console.log("Nie znaleziono endpointu");
      } else {
        console.log("Inny błąd API");
      }
      return;
    }

    let data = await response.json();

    let prosteNewsy = data.news.map(function (news) {
      return {
        title: news.title,
        published: news.published,
        url: news.url,
        author: news.author,
        language: news.language,
        category: news.category,
      };
    });

    let pelneNewsy = usunNiepelneNewsy(prosteNewsy);
    let unikalneNewsy = usunDuplikaty(pelneNewsy);

    let angielskieNewsy = filtrujPoJezyku(unikalneNewsy, "en");
    let generalneAngielskieNewsy = filtrujPoKategorii(
      angielskieNewsy,
      "general",
    );

    let posortowaneNewsy = sortujPoDacie(generalneAngielskieNewsy);
    let pierwsze5 = ograniczLiczbeNewsow(posortowaneNewsy, 5);

    console.log(pierwsze5);
  } catch (error) {
    console.log(error);
  }
}

function filtrujPoJezyku(newsy, jezyk) {
  return newsy.filter(function (news) {
    return news.language === jezyk;
  });
}

function filtrujPoKategorii(newsy, kategoria) {
  return newsy.filter(function (news) {
    return news.category.includes(kategoria);
  });
}

function sortujPoDacie(newsy) {
  return newsy.sort(function (a, b) {
    return new Date(b.published) - new Date(a.published);
  });
}

function ograniczLiczbeNewsow(newsy, limit) {
  return newsy.slice(0, limit);
}

function usunNiepelneNewsy(newsy) {
  return newsy.filter(function (news) {
    return (
      news.title &&
      news.title.trim() !== "" &&
      news.url &&
      news.url.trim() !== ""
    );
  });
}

function usunDuplikaty(newsy) {
  return newsy.filter(function (news, index) {
    return (
      index ===
      newsy.findIndex(function (innyNews) {
        return innyNews.url === news.url;
      })
    );
  });
}

function obliczPodobienstwo(tytulA, tytulB) {
  let slowaA = new Set(tytulA.toLowerCase().trim().split(" "));
  let slowaB = new Set(tytulB.toLowerCase().trim().split(" "));

  let wspolneSlowa = [...slowaA].filter(function (slowo) {
    return slowaB.has(slowo);
  });

  let wszystkieSlowa = new Set([...slowaA, ...slowaB]);

  return wspolneSlowa.length / wszystkieSlowa.size;
}

function czyNewsySaPodobne(newsA, newsB) {
  let podobienstwo = obliczPodobienstwo(newsA.title, newsB.title);

  return podobienstwo >= 0.5;
}

function znajdzPodobneNewsy(newsy, szukanyNews) {
  return newsy.filter(function (news) {
    return news !== szukanyNews && czyNewsySaPodobne(news, szukanyNews);
  });
}

pobierzNewsy();
