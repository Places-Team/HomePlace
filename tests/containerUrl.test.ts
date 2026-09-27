import { test } from "node:test";
import assert from "node:assert/strict";
import { containerOpenUrl } from "../src/lib/containerUrl";

test("container links wait for the browser host instead of rendering an empty address", () => {
  const template = "http://HOST_ADDRESS:3000";
  assert.equal(containerOpenUrl(template), null);
  assert.equal(containerOpenUrl(template, "192.168.0.68"), "http://192.168.0.68:3000/");
  assert.equal(containerOpenUrl(template, "home.example.com"), "http://home.example.com:3000/");
});

test("container links accept configured web URLs but reject malformed or unsafe schemes", () => {
  assert.equal(containerOpenUrl("https://example.com/app"), "https://example.com/app");
  assert.equal(containerOpenUrl("http://:3000"), null);
  assert.equal(containerOpenUrl("javascript:alert(1)"), null);
  assert.equal(containerOpenUrl("https://user:password@example.com"), null);
});
