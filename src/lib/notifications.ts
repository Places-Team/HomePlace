import "server-only";
import { prisma, getSetting, setSetting } from "./db";
import { groupNotificationEvents } from "./notificationGrouping";

/**
 * The notification centre.
 *
 * Not a second log — the events page is that. This is "what happened that I
 * have not looked at yet", read straight off the same Event table the feed and
 * the push notifier already write. "Seen" is a per-user timestamp, so two
 * people in the household do not clear each other's badge.
 */

const SEEN_PREFIX = "notifications.seen:";
const LIMIT = 30;
const FETCH_LIMIT = 300;

export type FeedItem = {
  id: string;
  type: string;
  severity: string;
  title: string;
  detail: string | null;
  at: number;
  count: number;
  url: string;
  occurrences: { id: string; at: number; detail: string | null }[];
};

/** The most recent events, and how many the user has not seen yet. */
export async function notificationFeed(userId: string): Promise<{ items: FeedItem[]; unread: number }> {
  const [rows, seen] = await Promise.all([
    prisma.event.findMany({ where: { OR: [{ userId: null }, { userId }] }, orderBy: { at: "desc" }, take: FETCH_LIMIT }),
    getSetting<number>(`${SEEN_PREFIX}${userId}`, 0),
  ]);
  const grouped = groupNotificationEvents(rows);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const items: FeedItem[] = grouped.slice(0, LIMIT).map((e) => ({
    id: e.id,
    type: e.type,
    severity: e.severity,
    title: e.title,
    detail: e.detail,
    at: e.at.getTime(),
    count: e.count,
    url: e.type === "plant-care" && e.actor ? `/plants?plant=${encodeURIComponent(e.actor)}` : `/events?event=${encodeURIComponent(e.id)}`,
    occurrences: e.eventIds.flatMap((id) => {
      const row = byId.get(id);
      return row ? [{ id, at: row.at.getTime(), detail: row.detail }] : [];
    }),
  }));
  return { items, unread: grouped.filter((event) => event.at.getTime() > seen).length };
}

/** Just the unread count — cheap enough to compute on every page render. */
export async function unreadFor(userId: string): Promise<number> {
  const seen = await getSetting<number>(`${SEEN_PREFIX}${userId}`, 0);
  const rows = await prisma.event.findMany({
    where: { at: { gt: new Date(seen) }, OR: [{ userId: null }, { userId }] },
    orderBy: { at: "desc" },
    take: FETCH_LIMIT,
  });
  return groupNotificationEvents(rows).length;
}

/** Mark everything up to now as seen for this user. */
export async function markSeen(userId: string): Promise<void> {
  await setSetting(`${SEEN_PREFIX}${userId}`, Date.now());
}
