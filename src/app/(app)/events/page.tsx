import Link from "next/link";
import { prisma } from "@/lib/db";
import { pageUser } from "@/lib/pageUser";
import { dict } from "@/i18n";
import { Card, EmptyState, Badge } from "@/components/ui";
import { AutoRefresh } from "@/components/AutoRefresh";
import { EventFilters } from "./EventFilters";
import { ago } from "@/lib/format";
import { groupTimelineEvents } from "@/lib/eventGroups";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 120;

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
  searchParams: Promise<{ type?: string; q?: string; severity?: string; event?: string; view?: string; page?: string }>;
}) {
  const user = await pageUser();
  const d = dict(user.locale);
  const query = await searchParams;

  const type = query.type ?? "";
  const severity = query.severity ?? "";
  const q = (query.q ?? "").trim();
  const view = query.view === "all" ? "all" : "grouped";
  const requestedPage = Number(query.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100) : 1;

  // Fetch only one page, plus one row to decide whether Older is available.
  // A linked event is fetched separately so a notification remains useful even
  // after it has moved beyond the first page of the journal.
  const [pageRows, linkedEvent] = await Promise.all([
    prisma.event.findMany({
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
      orderBy: [{ at: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
      include: { item: { select: { title: true } } },
    }),
    query.event
      ? prisma.event.findUnique({ where: { id: query.event }, include: { item: { select: { title: true } } } })
      : Promise.resolve(null),
  ]);
  const hasOlder = pageRows.length > PAGE_SIZE;
  const rows = pageRows.slice(0, PAGE_SIZE);
  if (linkedEvent && !rows.some((row) => row.id === linkedEvent.id)) rows.push(linkedEvent);
  rows.sort((a, b) => b.at.getTime() - a.at.getTime() || b.id.localeCompare(a.id));
  const grouped = groupTimelineEvents(rows);
  const events = view === "all" ? rows.map((row) => ({ ...row, count: 1, eventIds: [row.id] })) : grouped;
  const focusedIndex = query.event ? events.findIndex((event) => event.eventIds.includes(query.event!)) : -1;
  if (focusedIndex > 0) events.unshift(...events.splice(focusedIndex, 1));
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  function pageHref(nextPage: number) {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (severity) params.set("severity", severity);
    if (q) params.set("q", q);
    if (view === "all") params.set("view", "all");
    if (nextPage > 1) params.set("page", String(nextPage));
    return `/events${params.size ? `?${params.toString()}` : ""}`;
  }

  function viewHref(nextView: "grouped" | "all") {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (severity) params.set("severity", severity);
    if (q) params.set("q", q);
    if (nextView === "all") params.set("view", "all");
    return `/events${params.size ? `?${params.toString()}` : ""}`;
  }

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
      {page === 1 && view === "grouped" && !query.event && <AutoRefresh seconds={60} />}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">{d.events.title}</h1>
        <EventFilters d={d} type={type} q={q} severity={severity} />
      </div>

      <nav aria-label={d.events.viewLabel} className="mb-4 flex w-fit items-center gap-1 rounded-control border border-line bg-surface p-1">
        <Link
          href={viewHref("grouped")}
          aria-current={view === "grouped" ? "page" : undefined}
          className={`rounded-[6px] px-3 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-accent ${view === "grouped" ? "bg-raised font-medium text-text" : "text-muted hover:text-text"}`}
        >
          {d.events.groupedView}
        </Link>
        <Link
          href={viewHref("all")}
          aria-current={view === "all" ? "page" : undefined}
          className={`rounded-[6px] px-3 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-accent ${view === "all" ? "bg-raised font-medium text-text" : "text-muted hover:text-text"}`}
        >
          {d.events.allView}
        </Link>
      </nav>

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
              className={`grid scroll-mt-24 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-3 sm:flex sm:items-start ${focused ? "bg-accent/10" : ""}`}
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] ${
                  event.severity === "error" ? "bg-danger/10 text-danger" : event.severity === "warn" ? "bg-warn/10 text-warn" : "bg-ok/10 text-ok"
                }`}
                aria-hidden
              >
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden>
                  <rect x="2.5" y="2.5" width="11" height="11" rx="3" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M8 5.2v3.5m0 2.1h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </span>
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
              <div className="col-start-2 flex flex-wrap items-center gap-2 sm:ml-auto sm:shrink-0">
                {event.actor && <Badge>{event.actor}</Badge>}
                {event.count > 1 && <Badge>×{event.count}</Badge>}
                <span className="whitespace-nowrap text-xs text-faint">{ago(event.at, d)}</span>
              </div>
            </li>
          );})}
        </ul>
      </Card>
      )}

      {(page > 1 || hasOlder) && (
        <nav aria-label={d.events.pages} className="mt-4 flex items-center justify-between gap-3 text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="rounded-control px-3 py-2 text-accent hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent">
              ← {d.events.newer}
            </Link>
          ) : <span />}
          <span className="font-mono text-xs text-muted">{d.events.page} {page}</span>
          {hasOlder && page < 100 ? (
            <Link href={pageHref(page + 1)} className="rounded-control px-3 py-2 text-accent hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent">
              {d.events.older} →
            </Link>
          ) : <span />}
        </nav>
      )}
    </>
  );
}
