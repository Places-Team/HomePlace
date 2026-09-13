import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, uniqueSlug } from "../src/lib/slug";
import { inQuietHours } from "../src/lib/quietHours";
import { bytes, duration, latency, percent } from "../src/lib/format";
import { dashboardIconSlugs, dashboardIconUrl, guessKey, guessIcon, autoIcon, faviconUrl } from "../src/lib/icons";
import { nextOccurrence } from "../src/lib/recurrence";
import { createLinkInfo, isLinkServerId, LINK_PROTOCOL_MAX, LINK_PROTOCOL_MIN } from "../src/lib/linkProtocol";

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
    applicationVersion: "1.2.3",
    now: new Date("2026-09-13T12:00:00.000Z"),
  });

  assert.deepEqual(info, {
    product: "HomePlace",
    server: { id: "018f2b5c-7d9a-7e11-8a22-123456789abc", name: "Home server" },
    applicationVersion: "1.2.3",
    protocol: { min: LINK_PROTOCOL_MIN, max: LINK_PROTOCOL_MAX },
    serverTime: "2026-09-13T12:00:00.000Z",
    features: { pairing: false, realtime: false },
  });
  assert.equal("token" in info, false);
});

test("link server IDs accept UUIDs and reject arbitrary installation names", () => {
  assert.equal(isLinkServerId("018f2b5c-7d9a-7e11-8a22-123456789abc"), true);
  assert.equal(isLinkServerId("homeplace-at-home"), false);
  assert.equal(isLinkServerId("00000000-0000-0000-0000-000000000000"), false);
});
