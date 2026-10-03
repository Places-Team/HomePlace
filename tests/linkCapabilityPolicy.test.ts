import { test } from "node:test";
import assert from "node:assert/strict";
import { canRelayClipboard, withinApprovedCapabilities } from "../src/lib/linkCapabilityPolicy";

const approved = JSON.stringify([
  { name: "notification.receive", version: 1, constraints: {} },
  { name: "clipboard.send", version: 1, constraints: { mode: "foreground" } },
]);

test("heartbeat may temporarily report a subset and later restore it", () => {
  assert.equal(withinApprovedCapabilities(approved, []), true);
  assert.equal(withinApprovedCapabilities(approved, [
    { name: "clipboard.send", version: 1, constraints: { mode: "foreground" } },
  ]), true);
  assert.equal(withinApprovedCapabilities(approved, JSON.parse(approved)), true);
});

test("heartbeat cannot add or strengthen a capability beyond pairing approval", () => {
  assert.equal(withinApprovedCapabilities(approved, [
    { name: "file.receive", version: 1, constraints: {} },
  ]), false);
  assert.equal(withinApprovedCapabilities(approved, [
    { name: "clipboard.send", version: 2, constraints: { mode: "foreground" } },
  ]), false);
  assert.equal(withinApprovedCapabilities(approved, [
    { name: "clipboard.send", version: 1, constraints: {} },
  ]), false);
  assert.equal(withinApprovedCapabilities("not json", []), false);
});

test("clipboard relay requires both capability and approved permission", () => {
  const sending = JSON.stringify([{ name: "clipboard.send", version: 1, constraints: {} }]);
  assert.equal(canRelayClipboard(sending, "[]"), false);
  assert.equal(canRelayClipboard(sending, JSON.stringify(["clipboard.relay"])), true);
  assert.equal(canRelayClipboard("[]", JSON.stringify(["clipboard.relay"])), false);
  assert.equal(canRelayClipboard(sending, "invalid"), false);
});
