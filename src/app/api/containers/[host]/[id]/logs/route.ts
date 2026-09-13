import { type NextRequest } from "next/server";
import { currentUser } from "@/lib/session";
import { streamLogs } from "@/lib/docker";

export const dynamic = "force-dynamic";

/**
 * Container logs as they happen.
 *
 * Server-sent events rather than a websocket: the traffic goes one way, SSE
 * survives proxies that mangle upgrades, and the browser reconnects on its own.
 * The connection is closed when the client goes away, which is what stops the
 * `docker logs --follow` behind it.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ host: string; id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const { host, id } = await params;
  const tail = Number(req.nextUrl.searchParams.get("tail") ?? 200);
  const upstream = await streamLogs(host, id, Number.isFinite(tail) ? tail : 200, req.signal);
  if (!upstream) return new Response("not found", { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          // One SSE event per line. Blank lines are dropped: in this protocol
          // an empty data field would terminate the event early.
          for (const line of value.split("\n")) {
            if (line.trim() === "") continue;
            controller.enqueue(encoder.encode(`data: ${line}\n\n`));
          }
        }
      } catch {
        // The client hung up, or Docker closed the stream — either way there is
        // nothing to report and nothing to clean up beyond closing.
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      // Nginx buffers by default, which would hold the whole point of this
      // endpoint in a buffer until it filled.
      "x-accel-buffering": "no",
    },
  });
}
