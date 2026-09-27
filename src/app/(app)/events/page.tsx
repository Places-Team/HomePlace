import Link from "next/link";
import { prisma } from "@/lib/db";
import { pageUser } from "@/lib/pageUser";
import { dict } from "@/i18n";
import { Card, EmptyState, Badge } from "@/components/ui";
import { AutoRefresh } from "@/components/AutoRefresh";
import { EventFilters } from "./EventFilters";
import { ago } from "@/lib/format";
import { groupRecentEvents } from "@/lib/eventGroups";

export const dynamic = "force-dynamic";

/**
 * The feed of things that changed.
 *
 * Only transitions land here — a service going down or coming back, a restart
 * someone triggered, a sign-in. A row per probe would be a log, and nobody
 * reads a log looking for "what broke last night".
 */
export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; q?: string; severity?: string; event?: string }>;
}) {
  const user = await pageUser();
  const d = dict(user.locale);
  const query = await searchParams;

  const type = query.type ?? "";
  const severity = query.severity ?? "";
  const q = (query.q ?? "").trim();

  // "What happened with jellyfin this week" is the question this page exists
  // for, and unfiltered rows do not answer it. The feed keeps everything now —
  // group commands, sign-ins, restarts — so the limit is higher and the filters
  // do more of the narrowing.
  const rows = await prisma.event.findMany({
    where: {
      ...(type ? { type } : {}),
      ...(severity ? { severity } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q } },
              { detail: { contains: q } },
              { actor: { contains: q } },
              { item: { title: { contains: q } } },
            ],
          }
        : {}),
    },
    orderBy: { at: "desc" },
    take: 400,
    include: { item: { select: { title: true } } },
  });
  const events = groupRecentEvents(rows);
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  const label: Record<string, string> = {
    down: d.events.wentDown,
    up: d.events.cameUp,
    restart: d.events.restarted,
    login: d.events.signedIn,
    "auth-fail": d.events.authFailed,
    discovery: d.events.discovered,
    command: d.events.command,
    system: d.events.system,
    "telegram-bot": "",
    container: "",
  };

  return (
    <>
      <AutoRefresh seconds={60} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">{d.events.title}</h1>
        <EventFilters d={d} type={type} q={q} severity={severity} />
      </div>

      {events.length === 0 ? (
        <EmptyState title={q || type || severity ? d.events.noMatches : d.events.empty} />
      ) : (
      <Card>
        <ul className="divide-y divide-line">
          {events.map((event) => {
            const focused = !!query.event && event.eventIds.includes(query.event);
            const contextHref = event.type === "container" ? "/containers" : event.type === "telegram-bot" ? "/settings?section=integrations" : null;
            return (
            <li
              key={event.id}
              id={`event-${event.id}`}
              className={`flex scroll-mt-24 items-start gap-3 px-4 py-3 ${focused ? "bg-accent/10" : ""}`}
            >
              <span
                className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                  event.severity === "error" ? "bg-danger" : event.severity === "warn" ? "bg-warn" : "bg-ok"
                }`}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="font-medium">{event.item?.title ?? event.title}</span>{" "}
                  {label[event.type] && <span className="text-muted">{label[event.type]}</span>}
                </p>
                {(event.detail || event.count > 1 || contextHref) && (
                  <details className="group mt-1 min-w-0" open={focused}>
                    <summary className="cursor-pointer text-xs leading-relaxed text-muted hover:text-text focus-visible:text-text">
                      {event.detail ? <span className="line-clamp-2">{event.detail}</span> : d.events.details}
                    </summary>
                    <div className="mt-2 space-y-2 rounded-control bg-raised px-3 py-2 text-xs leading-relaxed text-muted">
                      {event.detail && <p className="whitespace-pre-wrap break-words">{event.detail}</p>}
                      {event.count > 1 && (
                        <ol className="space-y-1 border-t border-line pt-2">
                          {event.eventIds.map((id) => {
                            const occurrence = rowsById.get(id);
                            return occurrence ? (
                              <li key={id} className="flex flex-wrap gap-2">
                                <time className="tabular-nums" dateTime={occurrence.at.toISOString()}>
                                  {occurrence.at.toLocaleString(user.locale)}
                                </time>
                                {occurrence.detail && <span className="break-words">{occurrence.detail}</span>}
                              </li>
                            ) : null;
                          })}
                        </ol>
                      )}
                      {contextHref && (
                        <Link href={contextHref} className="inline-block font-medium text-accent hover:underline">
                          {event.type === "container" ? d.events.openContainers : d.events.openIntegrations} →
                        </Link>
                      )}
                    </div>
                  </details>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {event.actor && <Badge>{event.actor}</Badge>}
                {event.count > 1 && <Badge>×{event.count}</Badge>}
                <span className="whitespace-nowrap text-xs text-faint">{ago(event.at, d)}</span>
              </div>
            </li>
          );})}
        </ul>
      </Card>
      )}
    </>
  );
}
