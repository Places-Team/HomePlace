import { NextResponse, type NextRequest } from "next/server";
import { getSetting, setSetting } from "@/lib/db";
import { secretsEqual } from "@/lib/security";

export const dynamic = "force-dynamic";

/**
 * "What is playing right now", pushed in from outside.
 *
 * HomePlace cannot see what a desktop is playing — no server can. So it does
 * the half that is possible: it accepts a small POST and shows whatever was
 * sent. Anything on the PC that can make an HTTP request can feed it — a
 * userscript, a browser extension, a few lines of Python against the media
 * session API, an mpd hook.
 *
 *   curl -X POST http://panel:3200/api/now-playing \
 *        -H "authorization: Bearer <token from settings>" \
 *        -H "content-type: application/json" \
 *        -d '{"title":"Song","artist":"Band","art":"https://…/cover.jpg"}'
 *
 * The token is generated in the settings page. Without one configured the
 * endpoint refuses everything, so a panel nobody set this up on cannot have a
 * random passer-by writing to it.
 */

export type NowPlaying = {
  title: string;
  artist?: string;
  album?: string;
  /** Cover image URL, reachable from the browser. */
  art?: string;
  /** Seconds. */
  position?: number;
  duration?: number;
  playing: boolean;
  /** Set by the server, not the sender: senders' clocks cannot be trusted. */
  updatedAt: number;
  source?: string;
};

export async function POST(req: NextRequest) {
  const token = await getSetting<string>("nowplaying.token", "");
  if (!token) {
    return NextResponse.json({ error: "now-playing is not enabled — generate a token in settings" }, { status: 403 });
  }

  const header = req.headers.get("authorization") ?? "";
  const provided = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!secretsEqual(token, provided)) {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "expected JSON" }, { status: 400 });
  }

  // An empty title means "nothing is playing" — simpler for the sender than a
  // separate endpoint to clear the state.
  const title = String(body.title ?? "").trim();
  const state: NowPlaying = {
    title,
    artist: str(body.artist),
    album: str(body.album),
    art: str(body.art),
    position: numberOrUndefined(body.position),
    duration: numberOrUndefined(body.duration),
    playing: title !== "" && body.playing !== false,
    updatedAt: Date.now(),
    source: str(body.source),
  };

  await setSetting("nowplaying.state", state);
  return NextResponse.json({ ok: true });
}

function str(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? undefined : s.slice(0, 300);
}

function numberOrUndefined(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
