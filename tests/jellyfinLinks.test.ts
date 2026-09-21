import test from "node:test";
import assert from "node:assert/strict";
import { isHomeNetworkHost, jellyfinNativeLink, jellyfinWebLink } from "../src/lib/jellyfinLinks";

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
