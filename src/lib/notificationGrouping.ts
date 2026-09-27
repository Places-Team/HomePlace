import { groupRecentEvents, type GroupableEvent, type GroupedEvent } from "./eventGroups";

const REPEAT_WINDOW_MS = 24 * 60 * 60_000;

/** The bell is for things to act on; the Events page retains the full audit trail. */
export function groupNotificationEvents<T extends GroupableEvent>(events: T[]): GroupedEvent<T>[] {
  const relevant = events.filter((event) =>
    !(event.type === "login" && event.severity === "info") &&
    !(event.type === "telegram-bot" && event.severity === "info"),
  );
  const groups = groupRecentEvents(relevant);
  const result: GroupedEvent<T>[] = [];
  const latestByKey = new Map<string, GroupedEvent<T>>();

  for (const group of groups) {
    const key = JSON.stringify([
      group.type,
      group.severity,
      group.title,
      group.itemId ?? null,
      // Bot timeouts often have different transport details for one outage.
      group.type === "telegram-bot" && group.severity === "error" ? null : group.detail,
    ]);
    const previous = latestByKey.get(key);
    if (previous && previous.at.getTime() - group.at.getTime() <= REPEAT_WINDOW_MS) {
      previous.count += group.count;
      previous.eventIds.push(...group.eventIds);
      continue;
    }
    latestByKey.set(key, group);
    result.push(group);
  }

  return result;
}
