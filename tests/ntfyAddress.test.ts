import { test } from "node:test";
import assert from "node:assert/strict";
import { ntfyAddressError, ntfyEndpoint, ntfyResponseError } from "../src/lib/ntfyAddress";

test("ntfy accepts a server origin or reverse-proxy base path", () => {
  assert.equal(ntfyEndpoint(" https://ntfy.sh/ ", "homeplace"), "https://ntfy.sh/homeplace");
  assert.equal(ntfyEndpoint("http://192.168.0.68:8080/ntfy/", "alerts"), "http://192.168.0.68:8080/ntfy/alerts");
});

test("ntfy test failures explain authentication, routing, and throttling", () => {
  assert.match(ntfyResponseError(401), /access token/);
  assert.match(ntfyResponseError(404), /reverse-proxy path/);
  assert.match(ntfyResponseError(429), /rate-limiting/);
  assert.match(ntfyResponseError(503), /503/);
});

test("ntfy rejects malformed destinations before saving or sending", () => {
  assert.match(ntfyAddressError("ntfy.sh/AprelHost", "AprelHost") ?? "", /http:\/\//);
  assert.equal(ntfyEndpoint("https://user:secret@ntfy.sh", "alerts"), null);
  assert.equal(ntfyEndpoint("https://ntfy.sh", "alerts/other"), null);
  assert.equal(ntfyEndpoint("https://ntfy.sh", "alerts?x=1"), null);
  assert.equal(ntfyEndpoint("https://ntfy.sh", ""), null);
});
