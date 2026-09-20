import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { slugify, uniqueSlug } from "../src/lib/slug";
import { inQuietHours } from "../src/lib/quietHours";
import { bytes, duration, latency, percent } from "../src/lib/format";
import { dashboardIconSlugs, dashboardIconUrl, guessKey, guessIcon, autoIcon, faviconUrl } from "../src/lib/icons";
import { nextOccurrence } from "../src/lib/recurrence";
import { createLinkInfo, isLinkServerId, LINK_PROTOCOL_MAX, LINK_PROTOCOL_MIN, parseLinkPairRequest } from "../src/lib/linkProtocol";
import { parseShareMessage, safeFilename, safeSharedUrl } from "../src/lib/linkShare";
import { checkDeviceActionRateLimit } from "../src/lib/linkRateLimit";
import { clientAddress, hasMinimumSecretLength, isLocalHostname, safeRequestOrigin, secretsEqual } from "../src/lib/security";
import { compareVersions, releaseUpdateFrom } from "../src/lib/updates";
import { NOTIFY_EVENT_TYPES, shouldNotify } from "../src/lib/notifyPolicy";
import { isDue } from "../src/lib/cadence";
import { filesystemUsage } from "../src/lib/filesystemUsage";

/** Small pure helpers that everything else leans on. */

// ─────────────────────────────────── Slugs ───────────────────────────────

test("slugify: Cyrillic is transliterated, not escaped", () => {
  assert.equal(slugify("Домашняя"), "domashnyaya");
  assert.equal(slugify("Мой сервер"), "moy-server");
});

test("slugify: punctuation collapses into single dashes", () => {
  assert.equal(slugify("  Home // Lab!  "), "home-lab");
  assert.equal(slugify("a---b"), "a-b");
});

test("slugify: a name with nothing usable produces an empty string", () => {
  assert.equal(slugify("🎬🎬"), "");
});

test("uniqueSlug: collisions get a suffix, and the fallback covers emoji names", () => {
  assert.equal(uniqueSlug("Home", [], "id"), "home");
  assert.equal(uniqueSlug("Home", ["home"], "id"), "home-2");
  assert.equal(uniqueSlug("Home", ["home", "home-2"], "id"), "home-3");
  assert.equal(uniqueSlug("🎬", [], "abc123"), "abc123");
});

// ───────────────────────────────── Quiet hours ───────────────────────────

const at = (hours: number, minutes = 0) => new Date(2026, 0, 1, hours, minutes);

test("quiet hours: a window that crosses midnight covers both sides of it", () => {
  assert.equal(inQuietHours("23:00-08:00", at(23, 30)), true);
  assert.equal(inQuietHours("23:00-08:00", at(3)), true);
  assert.equal(inQuietHours("23:00-08:00", at(7, 59)), true);
  assert.equal(inQuietHours("23:00-08:00", at(8)), false);
  assert.equal(inQuietHours("23:00-08:00", at(12)), false);
});

test("quiet hours: a window inside one day behaves normally", () => {
  assert.equal(inQuietHours("09:00-17:00", at(12)), true);
  assert.equal(inQuietHours("09:00-17:00", at(8, 59)), false);
  assert.equal(inQuietHours("09:00-17:00", at(17)), false);
});

test("quiet hours: nothing configured means nothing is silenced", () => {
  assert.equal(inQuietHours("", at(3)), false);
  assert.equal(inQuietHours("nonsense", at(3)), false);
});

// ─────────────────────────────── Formatting ──────────────────────────────

test("bytes: binary units, because that is what disks report", () => {
  assert.equal(bytes(0), "0 B");
  assert.equal(bytes(1024), "1.0 KiB");
  assert.equal(bytes(1024 ** 3 * 1.5), "1.5 GiB");
});

test("duration: long uptimes stay readable", () => {
  assert.equal(duration(90), "1m");
  assert.equal(duration(3700), "1h 1m");
  assert.equal(duration(86400 * 12 + 3600 * 4), "12d 4h");
  assert.equal(duration(0), "—");
});

test("latency: sub-millisecond replies are not rounded to zero", () => {
  assert.equal(latency(0.4), "<1 ms");
  assert.equal(latency(42.6), "43 ms");
  assert.equal(latency(2500), "2.5 s");
  assert.equal(latency(null), "—");
});

test("percent: an absent value is a dash, not zero", () => {
  assert.equal(percent(null), "—");
  assert.equal(percent(12.34, 1), "12.3%");
});

test("cadence: first run is due and later runs wait for their interval", () => {
  assert.equal(isDue(0, 60_000, 100_000), true);
  assert.equal(isDue(50_000, 60_000, 100_000), false);
  assert.equal(isDue(40_000, 60_000, 100_000), true);
});

test("filesystem usage never treats missing availability as a full disk", () => {
  const [row] = filesystemUsage(
    [{ metric: { instance: "nas", mountpoint: "/data", device: "/dev/sdb1" }, value: 4_000_000_000_000 }],
    []
  );
  assert.equal(row.free, null);
  assert.equal(row.used, null);
  assert.equal(row.usedPercent, null);
});

test("filesystem usage joins exporters that omit device on availability", () => {
  const [row] = filesystemUsage(
    [{ metric: { instance: "nas", mountpoint: "/data", device: "/dev/sdb1" }, value: 4_000 }],
    [{ metric: { instance: "nas", mountpoint: "/data" }, value: 3_000 }]
  );
  assert.equal(row.free, 3_000);
  assert.equal(row.used, 1_000);
  assert.equal(row.usedPercent, 25);
});

// ────────────────────────────────── Icons ────────────────────────────────

test("icons: the most specific service name wins", () => {
  assert.equal(guessKey({ name: "jellyseerr" }), "jellyseerr");
  assert.equal(guessKey({ name: "qbittorrent" }), "qbittorrent");
  assert.equal(guessKey({ image: "linuxserver/sonarr:latest" }), "sonarr");
});

test("icons: the host of a URL is enough to recognise a service", () => {
  assert.equal(guessIcon({ url: "https://jellyfin.example.com" }), "🎬");
});

test("icons: an unknown name produces nothing rather than a wrong guess", () => {
  assert.equal(guessKey({ name: "totally-made-up-thing" }), "");
  assert.equal(guessIcon({ name: "totally-made-up-thing" }), "");
});

test("autoIcon: prefers the site's own favicon, falls back to the emoji", () => {
  assert.equal(autoIcon({ name: "sonarr", url: "http://box:8989" }), "http://box:8989/favicon.ico");
  assert.equal(autoIcon({ name: "sonarr" }), "📺");
  assert.equal(faviconUrl("not a url"), "");
});

test("autoIcon: the logo pack wins when it is switched on", () => {
  const icon = autoIcon({ name: "grafana", url: "http://box:3000", pack: true });
  assert.match(icon, /dashboard-icons@[a-f0-9]{40}\/png\/grafana\.png$/);
});

test("dashboard icons: catalogue input is validated and deduplicated", () => {
  assert.deepEqual(
    dashboardIconSlugs({ png: ["plex.png", "plex.png", "nextcloud-calendar.png", "../bad.png", 42] }),
    ["nextcloud-calendar", "plex"],
  );
  assert.deepEqual(dashboardIconSlugs({ png: "plex.png" }), []);
});

test("dashboard icons: unsafe slugs never become CDN URLs", () => {
  assert.match(dashboardIconUrl("Plex"), /\/plex\.png$/);
  assert.equal(dashboardIconUrl("../secret"), "");
  assert.equal(dashboardIconUrl("plex.svg"), "");
});

test("nextOccurrence lands in the future, however long it was ignored", () => {
  const lastMonth = new Date(Date.now() - 30 * 86400_000);

  const daily = nextOccurrence(lastMonth, "daily");
  assert.ok(daily.getTime() > Date.now(), "a daily reminder comes back tomorrow, not a month ago");

  const weekly = nextOccurrence(lastMonth, "weekly");
  assert.ok(weekly.getTime() > Date.now());
  // Still on the same weekday as it was originally set.
  assert.equal(weekly.getDay(), lastMonth.getDay());

  // A one-off never moves: it is due when it is due.
  const once = nextOccurrence(lastMonth, "none");
  assert.equal(once.getTime(), lastMonth.getTime());
});

// ────────────────────────────── HomePlace Link ──────────────────────────

test("link info exposes a versioned, secret-free discovery document", () => {
  const info = createLinkInfo({
    serverId: "018f2b5c-7d9a-7e11-8a22-123456789abc",
    serverName: "Home server",
    now: new Date("2026-09-13T12:00:00.000Z"),
  });

  assert.deepEqual(info, {
    product: "HomePlace",
    server: { id: "018f2b5c-7d9a-7e11-8a22-123456789abc", name: "Home server" },
    protocol: { min: LINK_PROTOCOL_MIN, max: LINK_PROTOCOL_MAX },
    serverTime: "2026-09-13T12:00:00.000Z",
    features: { pairing: true, realtime: false },
  });
  assert.equal("token" in info, false);
});

test("link server IDs accept UUIDs and reject arbitrary installation names", () => {
  assert.equal(isLinkServerId("018f2b5c-7d9a-7e11-8a22-123456789abc"), true);
  assert.equal(isLinkServerId("homeplace-at-home"), false);
  assert.equal(isLinkServerId("00000000-0000-0000-0000-000000000000"), false);
});

test("link pairing accepts only supported capabilities and protocol versions", () => {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const valid = {
    protocol: 1,
    device: { name: "Pixel", platform: "android", platformVersion: "15", appVersion: "0.1.0" },
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    capabilities: [{ name: "notification.receive", version: 1, constraints: {} }],
    permissions: ["dashboard.read", "reminder.manage", "clipboard.relay", "share.relay"],
  };
  assert.deepEqual(parseLinkPairRequest(valid), valid);
  assert.equal(parseLinkPairRequest({ ...valid, protocol: 2 }), null);
  assert.equal(parseLinkPairRequest({ ...valid, capabilities: [{ name: "system.shell", version: 1, constraints: {} }] }), null);
  assert.equal(parseLinkPairRequest({ ...valid, permissions: ["system.shell"] }), null);
  assert.equal(parseLinkPairRequest({ ...valid, publicKey: Buffer.alloc(65).toString("base64") }), null);
});

test("shared content accepts bounded text and safe web links", () => {
  assert.deepEqual(parseShareMessage({ type: "text", value: " hello ", targetDeviceId: "device_1" }), {
    type: "text", value: "hello", targetDeviceId: "device_1",
  });
  assert.equal(safeSharedUrl("https://example.com/path"), true);
  assert.equal(safeSharedUrl("https://user:secret@example.com"), false);
  assert.equal(safeSharedUrl("file:///etc/passwd"), false);
  assert.equal(parseShareMessage({ type: "url", value: "javascript:alert(1)", targetDeviceId: "device_1" }), null);
  assert.equal(parseShareMessage({ type: "text", value: "x".repeat(8001), targetDeviceId: "device_1" }), null);
});

test("shared filenames cannot escape the private transfer directory", () => {
  assert.equal(safeFilename("../../family/photo.jpg"), ".._.._family_photo.jpg");
  assert.equal(safeFilename("\u0000"), "shared-file");
});

test("authenticated share actions are rate limited per device", () => {
  assert.equal(checkDeviceActionRateLimit("rate-test-device", "share", 2).allowed, true);
  assert.equal(checkDeviceActionRateLimit("rate-test-device", "share", 2).allowed, true);
  const blocked = checkDeviceActionRateLimit("rate-test-device", "share", 2);
  assert.equal(blocked.allowed, false);
  assert.ok((blocked.retryAfterSeconds ?? 0) > 0);
  assert.equal(checkDeviceActionRateLimit("other-device", "share", 2).allowed, true);
});

// ───────────────────────────────── Security ─────────────────────────────

test("secret comparison handles equal, different and empty values", () => {
  assert.equal(secretsEqual("correct horse battery staple", "correct horse battery staple"), true);
  assert.equal(secretsEqual("correct horse battery staple", "correct horse battery staplf"), false);
  assert.equal(secretsEqual("", ""), false);
});

test("session secrets require at least 32 bytes", () => {
  assert.equal(hasMinimumSecretLength("a".repeat(31)), false);
  assert.equal(hasMinimumSecretLength("a".repeat(32)), true);
  assert.equal(hasMinimumSecretLength("пароль-длиной-в-тридцать-два-байта"), true);
});

test("forwarded client addresses are ignored unless a sanitizing proxy is trusted", () => {
  const requestHeaders = new Headers({ "x-forwarded-for": "203.0.113.8, 10.0.0.2", "x-real-ip": "203.0.113.9" });
  assert.equal(clientAddress(requestHeaders, false), "untrusted-proxy");
  assert.equal(clientAddress(requestHeaders, true), "203.0.113.8");
  assert.equal(clientAddress(new Headers({ "x-forwarded-for": "not-an-address" }), true), "unknown");
});

test("local hostname detection is limited to loopback and private networks", () => {
  for (const host of ["localhost", "homeplace.local", "127.0.0.1", "10.0.0.5", "172.16.0.1", "192.168.1.5", "::1", "fd00::1"]) {
    assert.equal(isLocalHostname(host), true, host);
  }
  for (const host of ["example.com", "172.15.0.1", "172.32.0.1", "8.8.8.8", "2001:4860:4860::8888"]) {
    assert.equal(isLocalHostname(host), false, host);
  }
});

test("request origins reject spoofed hosts and trust forwarding only when enabled", () => {
  const spoofed = new Headers({ host: "home.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "http" });
  assert.equal(safeRequestOrigin(spoofed, "https://home.example", false), "https://home.example");
  assert.equal(safeRequestOrigin(spoofed, "https://home.example", true), null);

  const proxied = new Headers({ host: "127.0.0.1:3200", "x-forwarded-host": "home.example", "x-forwarded-proto": "https" });
  assert.equal(safeRequestOrigin(proxied, "https://home.example", true), "https://home.example");
  assert.equal(safeRequestOrigin(new Headers({ host: "192.168.1.20:3200" }), "http://localhost:3200", false), "http://192.168.1.20:3200");
  assert.equal(safeRequestOrigin(new Headers({ host: "attacker.example" }), "http://localhost:3200", false), null);
});

// ──────────────────────────────── Updates ───────────────────────────────

test("version comparison handles prefixes, numeric components and prereleases", () => {
  assert.equal(compareVersions("v1.2.3", "1.2.3"), 0);
  assert.equal(compareVersions("1.9.9", "1.10.0"), -1);
  assert.equal(compareVersions("2.0.0", "1.99.99"), 1);
  assert.equal(compareVersions("1.0.0-beta.1", "1.0.0"), -1);
  assert.equal(compareVersions("not-a-version", "1.0.0"), null);
});

test("release updates accept only newer HomePlace GitHub release links", () => {
  assert.deepEqual(
    releaseUpdateFrom(
      { tag_name: "v1.2.0", html_url: "https://github.com/Places-Team/HomePlace/releases/tag/v1.2.0" },
      "1.1.0",
    ),
    {
      currentVersion: "1.1.0",
      latestVersion: "1.2.0",
      releaseUrl: "https://github.com/Places-Team/HomePlace/releases/tag/v1.2.0",
    },
  );
  assert.equal(
    releaseUpdateFrom(
      { tag_name: "v1.2.0", html_url: "https://evil.example/Places-Team/HomePlace/releases/tag/v1.2.0" },
      "1.1.0",
    ),
    null,
  );
  assert.equal(
    releaseUpdateFrom(
      { tag_name: "v1.0.0", html_url: "https://github.com/Places-Team/HomePlace/releases/tag/v1.0.0" },
      "1.1.0",
    ),
    null,
  );
});

test("Telegram bot outages participate in the phone notification policy", () => {
  assert.equal(NOTIFY_EVENT_TYPES.includes("telegram-bot"), true);
  assert.equal(shouldNotify("telegram-bot", "error", { minSeverity: "error", types: {} }), true);
  assert.equal(shouldNotify("telegram-bot", "error", { minSeverity: "info", types: { "telegram-bot": "never" } }), false);
});
