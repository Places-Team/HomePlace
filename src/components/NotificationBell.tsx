"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchNotifications, markNotificationsSeen } from "@/actions/notifications";
import { ago } from "@/lib/format";
import type { Dictionary } from "@/i18n";
import type { FeedItem } from "@/lib/notifications";

/**
 * The notification bell in the top bar.
 *
 * The unread count is computed server-side for first paint (no flash of a wrong
 * number); the list itself is fetched only when the bell is opened, so a bar
 * that renders on every page does not pull thirty rows nobody asked to see.
 * Opening the panel is what marks things read — the same gesture a person makes
 * to check them.
 */
export function NotificationBell({ d, initialUnread }: { d: Dictionary; initialUnread: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [unread, setUnread] = useState(initialUnread);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Keep the badge honest without a page navigation: while the panel is closed
  // and the tab is visible, re-count every minute. The panel being open already
  // means everything is read, so polling then would only fight the "seen" write.
  useEffect(() => {
    if (open) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      void fetchNotifications().then((feed) => {
        setItems(feed.items);
        setLoaded(true);
        setUnread(feed.unread);
      });
    }, 60_000);
    return () => clearInterval(id);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      const feed = await fetchNotifications();
      setItems(feed.items);
      setLoaded(true);
      if (feed.unread > 0) {
        setUnread(0);
        await markNotificationsSeen();
      }
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={d.bell.aria}
        aria-expanded={open}
        className="relative flex h-8 w-8 items-center justify-center rounded-control text-muted transition-colors hover:bg-raised hover:text-text"
      >
        <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M8 1.75a3.5 3.5 0 0 0-3.5 3.5c0 2.5-.75 3.75-1.25 4.4-.2.26 0 .6.32.6h8.86c.32 0 .52-.34.32-.6-.5-.65-1.25-1.9-1.25-4.4A3.5 3.5 0 0 0 8 1.75Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d="M6.5 12.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          {/* On a phone the bell is not the rightmost thing in the bar, so an
              absolute right-0 dropdown of a fixed width runs off the left edge.
              Pin it to the viewport just under the header there, and fall back
              to the anchored dropdown from sm up. */}
          <div className="fixed right-2 top-14 z-30 w-[calc(100vw-1rem)] overflow-hidden rounded-card border border-line bg-surface shadow-pop sm:absolute sm:right-0 sm:top-auto sm:mt-1 sm:w-[26rem]">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="text-sm font-semibold">{d.bell.title}</span>
              <Link
                href="/events"
                onClick={() => setOpen(false)}
                className="text-xs text-muted transition-colors hover:text-text"
              >
                {d.bell.all}
              </Link>
            </div>

            <ul className="max-h-[min(70vh,26rem)] divide-y divide-line overflow-y-auto">
              {loaded && items.length === 0 && (
                <li className="px-3 py-8 text-center text-sm text-muted">{d.bell.empty}</li>
              )}
              {items.map((it) => (
                <li key={it.id} className="px-3 py-2.5">
                  <button
                    type="button"
                    className="flex w-full gap-2.5 rounded-control text-left outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-accent"
                    aria-expanded={expanded === it.id}
                    onClick={() => setExpanded(expanded === it.id ? null : it.id)}
                  >
                    <span
                      aria-hidden
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] ${
                        it.severity === "error"
                          ? "bg-danger/10 text-danger"
                          : it.severity === "warn"
                            ? "bg-warn/10 text-warn"
                            : "bg-raised text-muted"
                      }`}
                    >
                      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden>
                        <rect x="2.5" y="2.5" width="11" height="11" rx="3" stroke="currentColor" strokeWidth="1.2" />
                        <path d="M8 5.2v3.5m0 2.1h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                      <span className="truncate">{it.title}</span>
                      {it.count > 1 && <span className="shrink-0 rounded-control bg-raised px-1.5 text-xs tabular-nums text-muted">×{it.count}</span>}
                    </span>
                    {it.detail && <span className="block truncate text-xs text-muted">{it.detail}</span>}
                    <span className="mt-0.5 block text-[11px] text-faint">{ago(it.at, d)}</span>
                  </span>
                    <svg
                      viewBox="0 0 16 16"
                      aria-hidden
                      className={`h-4 w-4 self-center text-muted transition-transform ${expanded === it.id ? "rotate-180" : ""}`}
                    >
                      <path d="m4.5 6 3.5 3.5L11.5 6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  {expanded === it.id && (
                    <div id={`notification-${it.id}`} className="ml-4 mt-3 border-l border-line pl-3">
                      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted">
                        {it.detail || d.bell.noDetails}
                      </p>
                      {it.count > 1 && (
                        <ol className="mt-2 max-h-36 space-y-1 overflow-y-auto text-xs text-faint">
                          {it.occurrences.map((occurrence) => (
                            <li key={occurrence.id} className="flex gap-2">
                              <time className="shrink-0 tabular-nums" dateTime={new Date(occurrence.at).toISOString()}>
                                {new Date(occurrence.at).toLocaleString(document.documentElement.lang)}
                              </time>
                              {occurrence.detail && <span className="truncate">{occurrence.detail}</span>}
                            </li>
                          ))}
                        </ol>
                      )}
                      <Link
                        href={it.url}
                        onClick={() => setOpen(false)}
                        className="mt-3 inline-flex rounded-control px-2 py-1 text-sm font-medium text-accent hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {d.bell.openEvent} →
                      </Link>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
