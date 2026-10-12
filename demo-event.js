// Standalone demonstration; this file can be removed without changing the news pipeline.
const { openDatabase, createEvent } = require("./storage");

// An optional path allows persistence checks in a separate test database.
const database = openDatabase(process.argv[2]);
const demoEventId = "pulse-demo-event-v1";

try {
  const existingEvent = database.getEvents().find((event) => event.id === demoEventId);

  if (existingEvent) {
    console.log("Loaded an event saved during a previous run.");
  } else {
    const event = createEvent({
      title: "Demonstracja trwałego EVENT-u Pulse",
      eventType: "demonstracja",
    });
    // The fixed ID is specific to this demo and prevents duplicate demo events.
    event.id = demoEventId;
    database.saveEvent(event);
    console.log("Saved the demo event in SQLite.");
  }

  console.log(JSON.stringify(database.getEvents(), null, 2));
} finally {
  database.close();
}
