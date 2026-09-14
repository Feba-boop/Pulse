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

    let angielskieNewsy = filtrujPoJezyku(prosteNewsy, "en");
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

pobierzNewsy();
