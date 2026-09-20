import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { haConfig, haMediaPlayers } from "@/lib/services";
import { limitedBytes } from "@/lib/outbound";

/**
 * Cover art from Home Assistant, served through the panel.
 *
 * Two reasons this exists rather than pointing an `<img>` straight at Home
 * Assistant:
 *
 * - The player tile colours itself from the artwork, and reading pixels out of
 *   a canvas is forbidden once a cross-origin image has touched it. Same origin
 *   is the only way to look at the picture the browser is already showing.
 * - The panel may be reached from outside the network Home Assistant lives on.
 *   The server can see it either way.
 *
 * The address is not free-form — see the check below for what is allowed and
 * why, because "proxy whatever you are asked to" is a request forwarder for
 * anyone with a session.
 */
export async function GET(req: Request) {
  if (!(await currentUser())) return new NextResponse("unauthorized", { status: 401 });

  const wanted = new URL(req.url).searchParams.get("u");
  if (!wanted) return new NextResponse("missing url", { status: 400 });

  const cfg = await haConfig();
  if (!cfg) return new NextResponse("home assistant is not configured", { status: 404 });

  const base = new URL(cfg.url);
  let target: URL;
  try {
    // A path is resolved against Home Assistant; a full URL is checked below.
    target = new URL(wanted, base);
  } catch {
    return new NextResponse("bad url", { status: 400 });
  }

  /*
   * Whose picture is this?
   *
   * Home Assistant serves the artwork itself for some players and hands out the
   * music service's own CDN address for others — Spotify, Yandex and Sonos all
   * do the latter, which is most of the covers anyone actually looks at. So an
   * address outside Home Assistant cannot simply be refused.
   *
   * It cannot simply be allowed either, or this is a request forwarder for
   * anyone with a session. The rule is: Home Assistant must be advertising this
   * exact picture right now. That makes the allowlist the state of the house,
   * which is the only list that stays correct on its own.
   *
   * Compared on origin rather than on prefix — "https://ha.example.com.evil
   * .test" starts with the configured address as a string and is a different
   * machine.
   */
  const own = target.origin === base.origin;
  if (!own) {
    const players = await haMediaPlayers();
    if (!players?.some((p) => p.art === target.href)) {
      console.warn(`ha-art: refused ${target.origin} — no player is showing it`);
      return new NextResponse("forbidden", { status: 403 });
    }
  }

  const upstream = await fetch(target, {
    // The token goes to Home Assistant and nowhere else. A cover on a music
    // service's CDN needs no credential from us, and handing one over would be
    // giving the house keys to a stranger for a picture.
    headers: own ? { authorization: `Bearer ${cfg.token}` } : undefined,
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  }).catch((e) => {
    console.warn(`ha-art: ${target.pathname} did not answer:`, e instanceof Error ? e.message : e);
    return null;
  });

  if (!upstream) return new NextResponse("no answer", { status: 502 });
  if (!upstream.ok) {
    console.warn(`ha-art: ${target.pathname} → HTTP ${upstream.status}`);
    return new NextResponse("not found", { status: 404 });
  }

  const type = upstream.headers.get("content-type") ?? "";
  // Only pictures come back through here, whatever the upstream was asked for.
  if (!type.startsWith("image/")) {
    console.warn(`ha-art: ${target.pathname} returned ${type || "no content type"}`);
    return new NextResponse("not an image", { status: 415 });
  }

  // Keep proxy responses bounded: artwork is untrusted even when HA advertised it.
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await limitedBytes(upstream, 12 * 1024 * 1024);
  } catch {
    return new NextResponse("image too large", { status: 413 });
  }
  return new NextResponse(bytes, {
    headers: {
      "content-type": type,
      // Art changes when the track does, and the URL carries the track's own
      // token — a short cache is enough to stop a poll refetching it.
      "cache-control": "private, max-age=60",
    },
  });
}
