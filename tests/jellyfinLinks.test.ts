import test from "node:test";
import assert from "node:assert/strict";
import { isHomeNetworkHost, jellyfinNativeLink, jellyfinWebBase, jellyfinWebLink } from "../src/lib/jellyfinLinks";

test("Jellyfin local routing recognizes private and local hosts", () => {
  for (const host of ["192.168.0.68", "10.0.0.2", "172.16.4.9", "homeplace.local", "localhost", "server"]) {
    assert.equal(isHomeNetworkHost(host), true, host);
  }
  for (const host of ["home.example.com", "172.15.0.1", "8.8.8.8"]) {
    assert.equal(isHomeNetworkHost(host), false, host);
  }
});

test("Jellyfin links encode item ids and normalize a trailing slash", () => {
  assert.equal(jellyfinWebLink("https://media.example.com/", "film 1"), "https://media.example.com/web/index.html#!/details?id=film%201");
  assert.equal(
    jellyfinNativeLink("jellyfin://server/user/item/{id}", "film/1"),
    "jellyfin://server/user/item/film%2F1"
  );
});

test("Jellyfin web base never falls back to the HomePlace origin", () => {
  assert.equal(
    jellyfinWebBase({ publicUrl: "", localUrl: "http://192.168.0.68:8096", preferLocal: false }),
    "http://192.168.0.68:8096"
  );
  assert.equal(
    jellyfinWebBase({ publicUrl: "https://jf.example.com", localUrl: "http://192.168.0.68:8096", preferLocal: false }),
    "https://jf.example.com"
  );
  assert.equal(
    jellyfinWebBase({ publicUrl: "https://jf.example.com", localUrl: "http://192.168.0.68:8096", preferLocal: true }),
    "http://192.168.0.68:8096"
  );
});
