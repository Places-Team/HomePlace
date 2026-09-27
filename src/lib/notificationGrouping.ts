import { groupTimelineEvents, type GroupableEvent, type GroupedEvent } from "./eventGroups";

/** The bell is for things to act on; the Events page retains the full audit trail. */
export function groupNotificationEvents<T extends GroupableEvent>(events: T[]): GroupedEvent<T>[] {
  const relevant = events.filter((event) =>
    !(event.type === "login" && event.severity === "info") &&
    !(event.type === "telegram-bot" && event.severity === "info"),
  );
  return groupTimelineEvents(relevant);
}
