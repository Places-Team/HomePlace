export type PendingLinkNotification = { id: string; payload: string };

export type LinkNotificationMessage = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  urgent?: boolean;
};

export type QueueAction =
  | { kind: "append" }
  | { kind: "replace"; id: string }
  | { kind: "evict"; id: string }
  | { kind: "skip" };

function metadata(payload: string): { tag?: string; urgent?: boolean } {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!parsed || typeof parsed !== "object") return {};
    const value = parsed as Record<string, unknown>;
    return {
      tag: typeof value.tag === "string" ? value.tag : undefined,
      urgent: value.urgent === true,
    };
  } catch {
    return {};
  }
}

/** Keep the latest state for a tag, and reserve a full queue for incidents. */
export function chooseLinkNotificationAction(
  pending: PendingLinkNotification[],
  message: LinkNotificationMessage,
  capacity: number,
): QueueAction {
  if (message.tag) {
    const duplicate = pending.find((event) => metadata(event.payload).tag === message.tag);
    if (duplicate) return { kind: "replace", id: duplicate.id };
  }

  if (pending.length < capacity) return { kind: "append" };
  if (message.urgent) {
    const oldestRoutine = pending.find((event) => !metadata(event.payload).urgent);
    if (oldestRoutine) return { kind: "evict", id: oldestRoutine.id };
  }
  return { kind: "skip" };
}
