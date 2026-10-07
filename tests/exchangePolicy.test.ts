import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXCHANGE_TEXT_LIMIT,
  exchangeTokenHash,
  newExchangeToken,
  newShortCode,
  parseExchangeOptions,
  validExchangeText,
  validExchangeToken,
  validShortCode,
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

test("quick exchange codes are five unambiguous characters", () => {
  const code = newShortCode();
  assert.equal(code.length, 5);
  assert.equal(validShortCode(code), true);
  assert.equal(validShortCode("OOOOO"), false);
  assert.equal(validShortCode("../x/"), false);
  assert.deepEqual(parseExchangeOptions({ quick: true, expiresInSeconds: 86400, access: "account" }), {
    expiresInSeconds: 600, access: "link", deleteAfterOpen: true, quick: true,
  });
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

test("public one-time exchanges automatically use five-character quick links for older clients", () => {
  for (const quick of [undefined, false, true]) {
    assert.deepEqual(parseExchangeOptions({ access: "link", deleteAfterOpen: true, expiresInSeconds: 86400, quick }), {
      expiresInSeconds: 600, access: "link", deleteAfterOpen: true, quick: true,
    });
  }
  assert.deepEqual(parseExchangeOptions({ deleteAfterOpen: true }), {
    expiresInSeconds: 600, access: "link", deleteAfterOpen: true, quick: true,
  });
});

test("automatic short links never make account-only data public or shorten reusable links", () => {
  assert.deepEqual(parseExchangeOptions({ access: "account", deleteAfterOpen: true, expiresInSeconds: 86400, quick: false }), {
    expiresInSeconds: 86400, access: "account", deleteAfterOpen: true,
  });
  assert.deepEqual(parseExchangeOptions({ access: "link", deleteAfterOpen: false, expiresInSeconds: 86400 }), {
    expiresInSeconds: 86400, access: "link", deleteAfterOpen: false,
  });
  assert.equal(parseExchangeOptions({ access: "link", deleteAfterOpen: true, quick: "false" }), null);
});

test("exchange text is bounded by UTF-8 bytes", () => {
  assert.equal(validExchangeText("  "), false);
  assert.equal(validExchangeText("a".repeat(EXCHANGE_TEXT_LIMIT)), true);
  assert.equal(validExchangeText("я".repeat(EXCHANGE_TEXT_LIMIT)), false);
});
