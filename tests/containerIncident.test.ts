import assert from "node:assert/strict";
import { test } from "node:test";
import { dockerUptimeSeconds, nextContainerIncident, observedRestart } from "../src/lib/containerIncident";

const at = (minutes: number) => new Date(minutes * 60_000);

test("a brief unhealthy state does not announce an outage", () => {
  const initial = nextContainerIncident(null, false, false, at(0));
  const pending = nextContainerIncident(initial.state, true, false, at(1));
  assert.equal(pending.event, undefined);
  assert.equal(nextContainerIncident(pending.state, false, false, at(3)).event, undefined);
});

test("a sustained problem announces once and recovery closes it", () => {
  const pending = nextContainerIncident(null, true, false, at(0));
  assert.equal(nextContainerIncident(pending.state, true, false, at(4)).event, undefined);
  const down = nextContainerIncident(pending.state, true, false, at(5));
  assert.equal(down.event, "down");
  assert.equal(nextContainerIncident(down.state, true, false, at(6)).event, undefined);
  assert.equal(nextContainerIncident(down.state, false, false, at(7)).event, "up");
});

test("a visible Docker restart creates one non-critical event", () => {
  const up = nextContainerIncident(null, false, false, at(0));
  const restarting = nextContainerIncident(up.state, true, true, at(1));
  const restored = nextContainerIncident(restarting.state, false, false, at(2));
  assert.equal(restored.event, "restart");
  assert.equal(nextContainerIncident(restored.state, false, false, at(3)).event, undefined);
});

test("a restart between probes is recognized from Docker uptime or replacement", () => {
  assert.equal(dockerUptimeSeconds("Up 2 minutes (healthy)"), 120);
  assert.equal(dockerUptimeSeconds("Up less than a second"), 0);
  assert.equal(dockerUptimeSeconds("Exited (0) 2 minutes ago"), null);
  const before = { id: "same", seconds: 1800, at: 0 };
  assert.equal(observedRestart(before, { id: "same", seconds: 60, at: 60_000 }), true);
  assert.equal(observedRestart(before, { id: "same", seconds: 1800, at: 60_000 }), false);
  assert.equal(observedRestart(before, { id: "replacement", seconds: 60, at: 60_000 }), true);
});
