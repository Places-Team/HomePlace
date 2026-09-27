import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXCHANGE_TEXT_LIMIT,
  exchangeTokenHash,
  newExchangeToken,
  parseExchangeOptions,
  validExchangeText,
  validExchangeToken,
} from "../src/lib/exchangePolicy";

test("exchange links use independent high-entropy URL-safe tokens", () => {
  const first = newExchangeToken();
  const second = newExchangeToken();
  assert.equal(validExchangeToken(first), true);
  assert.notEqual(first, second);
  assert.equal(exchangeTokenHash(first).length, 64);
  assert.notEqual(exchangeTokenHash(first), exchangeTokenHash(second));
  assert.equal(validExchangeToken("short-code"), false);
  assert.equal(validExchangeToken("../" + first), false);
});

test("exchange options default to expiring public links", () => {
  assert.deepEqual(parseExchangeOptions({}), { expiresInSeconds: 3600, access: "link", deleteAfterOpen: false });
  assert.deepEqual(parseExchangeOptions({ expiresInSeconds: 600, access: "account", deleteAfterOpen: true }), {
    expiresInSeconds: 600, access: "account", deleteAfterOpen: true,
  });
  assert.equal(parseExchangeOptions({ expiresInSeconds: 0 }), null);
  assert.equal(parseExchangeOptions({ expiresInSeconds: 86401 }), null);
  assert.equal(parseExchangeOptions({ access: "everyone" }), null);
  assert.equal(parseExchangeOptions({ deleteAfterOpen: "true" }), null);
});

test("exchange text is bounded by UTF-8 bytes", () => {
  assert.equal(validExchangeText("  "), false);
  assert.equal(validExchangeText("a".repeat(EXCHANGE_TEXT_LIMIT)), true);
  assert.equal(validExchangeText("я".repeat(EXCHANGE_TEXT_LIMIT)), false);
});
