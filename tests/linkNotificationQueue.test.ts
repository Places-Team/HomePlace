import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseLinkNotificationAction, parseLinkNotificationPayload } from "../src/lib/linkNotificationQueue";

const pending = (id: string, tag?: string, urgent = false) => ({
  id,
  payload: JSON.stringify({ title: id, body: id, tag, urgent }),
});

test("a repeated tag replaces its pending event", () => {
  assert.deepEqual(
    chooseLinkNotificationAction(
      [pending("old", "item-server", true)],
      { title: "Recovered", body: "Server is back", tag: "item-server" },
      1,
    ),
    { kind: "replace", id: "old" },
  );
});

test("an urgent incident displaces the oldest routine event in a full queue", () => {
  assert.deepEqual(
    chooseLinkNotificationAction(
      [pending("critical", "item-1", true), pending("routine", "item-2")],
      { title: "Offline", body: "Server is down", urgent: true },
      2,
    ),
    { kind: "evict", id: "routine" },
  );
});

test("a full incident-only queue does not discard an incident", () => {
  assert.deepEqual(
    chooseLinkNotificationAction(
      [pending("first", "item-1", true)],
      { title: "Offline", body: "Another server is down", urgent: true },
      1,
    ),
    { kind: "skip" },
  );
});

test("routine events are skipped only when the queue is full", () => {
  const message = { title: "Update", body: "Update available" };
  assert.deepEqual(chooseLinkNotificationAction([], message, 1), { kind: "append" });
  assert.deepEqual(chooseLinkNotificationAction([pending("old")], message, 1), { kind: "skip" });
});

test("notification history accepts only bounded messages and local links", () => {
  assert.deepEqual(
    parseLinkNotificationPayload(JSON.stringify({ title: "HomePlace", body: "Service is down", url: "/events", urgent: true })),
    { title: "HomePlace", body: "Service is down", url: "/events", tag: undefined, urgent: true },
  );
  assert.equal(parseLinkNotificationPayload(JSON.stringify({ title: "", body: "Message" })), null);
  assert.equal(parseLinkNotificationPayload(JSON.stringify({ title: "Title", body: "x".repeat(2001) })), null);
  assert.equal(parseLinkNotificationPayload("not JSON"), null);
  assert.equal(parseLinkNotificationPayload(JSON.stringify({ title: "Title", body: "Message", url: "//other.example" }))?.url, undefined);
});
