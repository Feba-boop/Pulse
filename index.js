async function pobierzNewsy() {
  try {
    let response = await fetch("https://api.currentsapi.services/v1/latest-news", {
    headers: {
      Authorization: process.env.CURRENTS_API_KEY
    }
  });
    
    if (!response.ok) {
        if (response.status === 401) {
          console.log("Problem z kluczem API");
        }else if (response.status === 404) {
          console.log("Nie znaleziono endpointu");
        }else {
          console.log("Inny błąd API");
        }
        return;
    }
  
    let data = await response.json();
        console.log(data);

  for (let i = 0; i < 5 && i < data.news.length; i++) {
    console.log("Tytuł: " + data.news[i].title);
    console.log("Data: " + data.news[i].published);
    console.log("Link: " + data.news[i].url);
    console.log()
}
  } catch (error) {
    console.log(error);
}
}

pobierzNewsy();