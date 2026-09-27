import { test } from "node:test";
import assert from "node:assert/strict";
import { groupNotificationEvents } from "../src/lib/notificationGrouping";

const at = (hours: number) => new Date(Date.UTC(2026, 8, 27, hours));

function event(id: string, type: string, severity: string, title: string, detail: string, hours: number) {
  return { id, type, severity, title, detail, at: at(hours) };
}

test("the bell excludes routine sign-ins and bot recoveries while keeping the event log intact", () => {
  const events = [
    event("a", "login", "info", "Olmae signed in", "", 12),
    event("b", "telegram-bot", "info", "Bot available again", "", 11),
    event("c", "telegram-bot", "error", "Bot unavailable", "timeout", 10),
    event("d", "system", "warn", "Disk almost full", "90%", 9),
  ];
  assert.deepEqual(groupNotificationEvents(events).map((item) => item.id), ["c", "d"]);
  assert.equal(events.length, 4);
});

test("repeated bot failures become one bell item even if error details differ", () => {
  const grouped = groupNotificationEvents([
    event("latest", "telegram-bot", "error", "Bot unavailable", "connect timeout", 20),
    event("other", "system", "warn", "Disk almost full", "90%", 19),
    event("older", "telegram-bot", "error", "Bot unavailable", "proxy timeout", 8),
    event("oldest", "telegram-bot", "error", "Bot unavailable", "proxy timeout", -6),
  ]);
  assert.deepEqual(grouped.map((item) => [item.id, item.count]), [
    ["latest", 2],
    ["other", 1],
    ["oldest", 1],
  ]);
});

test("identical container incidents become one expandable bell item", () => {
  const grouped = groupNotificationEvents([
    event("new", "container", "error", "jellyfin unavailable", "health check failed", 20),
    event("old", "container", "error", "jellyfin unavailable", "health check failed", 8),
  ]);
  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0].eventIds, ["new", "old"]);
});
