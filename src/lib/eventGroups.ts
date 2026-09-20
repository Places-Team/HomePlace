const DEFAULT_WINDOW_MS = 10 * 60_000;

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
