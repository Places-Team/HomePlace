import "server-only";
import { prisma, getSetting, setSetting } from "./db";
import { groupRecentEvents } from "./eventGroups";

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
const FETCH_LIMIT = LIMIT * 4;

export type FeedItem = {
  id: string;
  type: string;
  severity: string;
  title: string;
  detail: string | null;
  at: number;
  count: number;
};

/** The most recent events, and how many the user has not seen yet. */
export async function notificationFeed(userId: string): Promise<{ items: FeedItem[]; unread: number }> {
  const [rows, seen] = await Promise.all([
    prisma.event.findMany({ orderBy: { at: "desc" }, take: FETCH_LIMIT }),
    getSetting<number>(`${SEEN_PREFIX}${userId}`, 0),
  ]);
  const items: FeedItem[] = groupRecentEvents(rows).slice(0, LIMIT).map((e) => ({
    id: e.id,
    type: e.type,
    severity: e.severity,
    title: e.title,
    detail: e.detail,
    at: e.at.getTime(),
    count: e.count,
  }));
  return { items, unread: items.filter((i) => i.at > seen).length };
}

/** Just the unread count — cheap enough to compute on every page render. */
export async function unreadFor(userId: string): Promise<number> {
  const seen = await getSetting<number>(`${SEEN_PREFIX}${userId}`, 0);
  const rows = await prisma.event.findMany({
    where: { at: { gt: new Date(seen) } },
    orderBy: { at: "desc" },
    take: 300,
  });
  return groupRecentEvents(rows).length;
}

/** Mark everything up to now as seen for this user. */
export async function markSeen(userId: string): Promise<void> {
  await setSetting(`${SEEN_PREFIX}${userId}`, Date.now());
}
