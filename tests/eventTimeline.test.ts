import assert from "node:assert/strict";
import { test } from "node:test";
import { groupTimelineEvents } from "../src/lib/eventGroups";

const at = (hours: number) => new Date(Date.UTC(2026, 8, 27, hours));

test("repeated incidents within a day retain every occurrence", () => {
  const grouped = groupTimelineEvents([
    { id: "new", type: "telegram-bot", severity: "error", title: "Bot unavailable", detail: "timeout", at: at(20) },
    { id: "other", type: "system", severity: "warn", title: "Disk full", detail: "91%", at: at(19) },
    { id: "old", type: "telegram-bot", severity: "error", title: "Bot unavailable", detail: "proxy refused", at: at(8) },
  ]);
  assert.deepEqual(grouped.map((event) => [event.id, event.count]), [["new", 2], ["other", 1]]);
  assert.deepEqual(grouped[0].eventIds, ["new", "old"]);
});

test("different actors and older incidents stay separate", () => {
  const grouped = groupTimelineEvents([
    { id: "a", type: "login", severity: "info", title: "Signed in", detail: null, actor: "Ana", at: at(28) },
    { id: "b", type: "login", severity: "info", title: "Signed in", detail: null, actor: "Ben", at: at(27) },
    { id: "c", type: "login", severity: "info", title: "Signed in", detail: null, actor: "Ana", at: at(1) },
  ]);
  assert.deepEqual(grouped.map((event) => event.count), [1, 1, 1]);
});
