import assert from "node:assert/strict";
import { test } from "node:test";
import { nextTelegramIncident } from "../src/lib/telegramIncident";

const at = (minutes: number) => new Date(minutes * 60_000);

test("short Telegram disconnects produce no incident", () => {
  const down = nextTelegramIncident(null, false, at(0));
  assert.equal(down.event, undefined);
  const restored = nextTelegramIncident(down.state, true, at(1));
  assert.equal(restored.state?.state, "up");
  assert.equal(restored.event, undefined);
});

test("one prolonged outage is reported and retried without duplicate events", () => {
  const initial = nextTelegramIncident(null, false, at(0));
  assert.equal(nextTelegramIncident(initial.state, false, at(4)).event, undefined);
  const alert = nextTelegramIncident(initial.state, false, at(5));
  assert.equal(alert.event, "down");
  assert.equal(alert.state?.state, "alerted");
  assert.equal(nextTelegramIncident(alert.state, false, at(6)).event, undefined);
});

test("a brief reconnect does not close an announced incident", () => {
  const alerted = { state: "alerted", since: at(0), notifiedAt: at(5) };
  const recovering = nextTelegramIncident(alerted, true, at(6));
  assert.equal(recovering.state?.state, "recovering");
  assert.equal(recovering.event, undefined);
  const dropped = nextTelegramIncident(recovering.state, false, at(7));
  assert.equal(dropped.state?.state, "alerted");
  assert.equal(dropped.event, undefined);
  const stable = nextTelegramIncident(dropped.state, true, at(8));
  assert.equal(nextTelegramIncident(stable.state, true, at(10)).event, "up");
});
