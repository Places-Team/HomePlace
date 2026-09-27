const DEFAULT_WINDOW_MS = 10 * 60_000;
const TIMELINE_WINDOW_MS = 24 * 60 * 60_000;

export type GroupableEvent = {
  id: string;
  type: string;
  severity: string;
  title: string;
  detail: string | null;
  at: Date;
  itemId?: string | null;
  actor?: string | null;
};

export type GroupedEvent<T extends GroupableEvent> = T & {
  count: number;
  eventIds: string[];
};

/**
 * Collapse identical nearby events for presentation while retaining every
 * database row as an audit record. Input is expected newest first.
 */
export function groupRecentEvents<T extends GroupableEvent>(
  events: T[],
  windowMs = DEFAULT_WINDOW_MS,
): GroupedEvent<T>[] {
  const groups: GroupedEvent<T>[] = [];
  const latestByKey = new Map<string, GroupedEvent<T>>();

  for (const event of events) {
    const key = JSON.stringify([
      event.type,
      event.severity,
      event.title,
      event.detail,
      event.itemId ?? null,
      event.actor ?? null,
    ]);
    const existing = latestByKey.get(key);
    if (existing && existing.at.getTime() - event.at.getTime() <= windowMs) {
      existing.count += 1;
      existing.eventIds.push(event.id);
      continue;
    }

    const group: GroupedEvent<T> = { ...event, count: 1, eventIds: [event.id] };
    groups.push(group);
    latestByKey.set(key, group);
  }

  return groups;
}

/** Merge repeated entries for a compact timeline without deleting audit rows. */
export function groupTimelineEvents<T extends GroupableEvent>(events: T[]): GroupedEvent<T>[] {
  const recent = groupRecentEvents(events);
  const groups: GroupedEvent<T>[] = [];
  const latestByKey = new Map<string, GroupedEvent<T>>();

  for (const group of recent) {
    const key = JSON.stringify([
      group.type,
      group.severity,
      group.title,
      group.itemId ?? null,
      group.actor ?? null,
      // Timeouts during one Telegram incident may carry different transport errors.
      group.type === "telegram-bot" && group.severity === "error" ? null : group.detail,
    ]);
    const previous = latestByKey.get(key);
    if (previous && previous.at.getTime() - group.at.getTime() <= TIMELINE_WINDOW_MS) {
      previous.count += group.count;
      previous.eventIds.push(...group.eventIds);
      continue;
    }
    latestByKey.set(key, group);
    groups.push(group);
  }

  return groups;
}
