import test from "node:test";
import assert from "node:assert/strict";
import { deviceView, deviceGraph, filterDevices, DEVICE_PERMISSION_GROUPS } from "../src/lib/deviceWorkspace";

const now = new Date("2026-10-07T09:00:00Z");
function row(id = "mac", userId: string | null = "owner") {
  const caps = JSON.stringify([{ name: "notification.receive", version: 1, constraints: {} }]);
  return { id, name: id, platform: "macos", platformVersion: "27", appVersion: "1", userId,
    user: userId ? { name: "Olmae" } : null, lastSeenAt: now, createdAt: now,
    capabilities: caps, approvedCapabilities: caps, permissions: '["plants.manage","clipboard.relay"]', allowHouseholdShares: false,
    credentialHash: "must-not-reach-browser", publicKey: "private-to-device-record" };
}

test("device projection exposes only public presentation fields and approved capabilities", () => {
  const view = deviceView(row(), now.getTime());
  assert.equal(view.online, true);
  assert.equal(view.ownerName, "Olmae");
  assert.deepEqual(view.capabilities, ["notification.receive"]);
  assert.ok(!JSON.stringify(view).includes("must-not-reach-browser"));
  assert.ok(!("credentialHash" in view) && !("publicKey" in view));
  assert.deepEqual(deviceView({ ...row(), approvedCapabilities: null }, now.getTime()).capabilities, []);
  assert.deepEqual(deviceView({ ...row(), capabilities: "bad-json", permissions: "null" }, now.getTime()).permissions, []);
});

test("graph links each device to its actual account, with a distinct unassigned branch", () => {
  const views = [deviceView(row()), deviceView({ ...row("phone", "other"), platform: "android" }), deviceView(row("test", null))];
  const graph = deviceGraph(views);
  assert.equal(graph.nodes.filter(n => n.kind === "server").length, 1);
  assert.equal(graph.nodes.filter(n => n.kind === "account").length, 3);
  assert.ok(graph.edges.some(e => e.from === "account:owner" && e.to === "device:mac"));
  assert.ok(graph.edges.some(e => e.from === "account:other" && e.to === "device:phone"));
  assert.ok(graph.edges.some(e => e.from === "unassigned" && e.to === "device:test"));
  assert.ok(!graph.edges.some(e => e.from === "account:owner" && e.to === "device:phone"));
  assert.equal(new Set(graph.nodes.map(n => `${n.x},${n.y}`)).size, graph.nodes.length);
});

test("graph layout is stable across status refreshes and grows without overlapping nodes", () => {
  const devices = Array.from({ length: 15 }, (_, i) => deviceView(row(`pc-${i}`)));
  const first = deviceGraph(devices);
  assert.deepEqual(deviceGraph([...devices].reverse()), first);
  for (const node of first.nodes) {
    assert.ok(node.x >= 0 && node.y >= 0);
    assert.ok(node.x + node.width <= first.width && node.y + node.height <= first.height);
  }
});

test("search combines owner and platform with honest online filtering", () => {
  const online = deviceView(row(), now.getTime());
  const offline = deviceView({ ...row("phone"), platform: "android", lastSeenAt: new Date(now.getTime() - 300000) }, now.getTime());
  assert.deepEqual(filterDevices([online, offline], "ANDROID", "all"), [offline]);
  assert.equal(filterDevices([online, offline], "olmae", "online").length, 1);
  assert.equal(filterDevices([online, offline], "", "offline").length, 1);
});

test("permission groups describe all existing permissions without adding new grants", () => {
  const permissions = DEVICE_PERMISSION_GROUPS.flatMap(group => [...group.permissions]);
  assert.equal(new Set(permissions.map(p => p.key)).size, 10);
  assert.deepEqual(permissions.filter(p => p.editable).map(p => p.key).sort(), ["clipboard.relay", "ideas.manage", "plants.manage", "share.relay"]);
  for (const permission of permissions) assert.ok(permission.ru && permission.en && permission.hintRu && permission.hintEn);
});
