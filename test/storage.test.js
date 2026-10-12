const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, readdirSync, unlinkSync, rmdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const { openDatabase, createEvent } = require("../storage");

function createTestDatabasePath(t) {
  const directory = mkdtempSync(join(tmpdir(), "pulse-event-test-"));
  t.after(() => {
    for (const file of readdirSync(directory)) {
      unlinkSync(join(directory, file));
    }
    rmdirSync(directory);
  });
  return join(directory, "test.sqlite");
}

test("Event fields persist after closing and reopening the database", (t) => {
  const databasePath = createTestDatabasePath(t);
  const event = createEvent({ title: "Firma O'Reilly: test '); DROP TABLE EVENT; --" });
  const database = openDatabase(databasePath);
  try {
    assert.deepEqual(database.getEvents(), []);
    database.saveEvent(event);
    assert.throws(() => database.saveEvent(event), /UNIQUE constraint failed/);
  } finally {
    database.close();
  }

  const reopenedDatabase = openDatabase(databasePath);
  try {
    assert.deepEqual(reopenedDatabase.getEvents(), [event]);
  } finally {
    reopenedDatabase.close();
  }
});

test("Demo saves once and loads the same event in a second process", (t) => {
  const databasePath = createTestDatabasePath(t);
  const demo = resolve(__dirname, "../demo-event.js");
  const first = spawnSync(process.execPath, [demo, databasePath], { encoding: "utf8", cwd: tmpdir() });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Saved the demo event/);

  const second = spawnSync(process.execPath, [demo, databasePath], { encoding: "utf8", cwd: tmpdir() });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /Loaded an event/);
  const parseOutput = (result) => JSON.parse(result.stdout.slice(result.stdout.indexOf("[")));
  assert.deepEqual(parseOutput(second), parseOutput(first));
  assert.equal(parseOutput(second).length, 1);
});

test("New events have unique IDs and UTC timestamps and reject empty titles", () => {
  const first = createEvent({ title: "Pierwszy" });
  const second = createEvent({ title: "Drugi" });
  assert.notEqual(first.id, second.id);
  assert.equal(first.startedAt, first.updatedAt);
  assert.equal(new Date(first.startedAt).toISOString(), first.startedAt);
  assert.throws(() => createEvent({ title: "   " }), TypeError);
});
