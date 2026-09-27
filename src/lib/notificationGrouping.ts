import { groupRecentEvents, type GroupableEvent, type GroupedEvent } from "./eventGroups";

const BOT_REPEAT_WINDOW_MS = 24 * 60 * 60_000;

/** The bell is for things to act on; the Events page retains the full audit trail. */
export function groupNotificationEvents<T extends GroupableEvent>(events: T[]): GroupedEvent<T>[] {
  const relevant = events.filter((event) =>
    !(event.type === "login" && event.severity === "info") &&
    !(event.type === "telegram-bot" && event.severity === "info"),
  );
  const groups = groupRecentEvents(relevant);
  const result: GroupedEvent<T>[] = [];
  const latestBotError = new Map<string, GroupedEvent<T>>();

  for (const group of groups) {
    if (group.type === "telegram-bot" && group.severity === "error") {
      const previous = latestBotError.get(group.title);
      if (previous && previous.at.getTime() - group.at.getTime() <= BOT_REPEAT_WINDOW_MS) {
        previous.count += group.count;
        previous.eventIds.push(...group.eventIds);
        continue;
      }
      latestBotError.set(group.title, group);
    }
    result.push(group);
  }

  return result;
}
