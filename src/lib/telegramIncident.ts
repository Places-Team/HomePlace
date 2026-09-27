/** Persisted bot outage state; ordinary reconnects never become incidents. */
export type TelegramIncidentState = {
  state: string;
  since: Date;
  notifiedAt: Date | null;
};

export const TELEGRAM_DOWN_DELAY_MS = 5 * 60_000;
export const TELEGRAM_RECOVERY_DELAY_MS = 2 * 60_000;

export function nextTelegramIncident(
  previous: TelegramIncidentState | null,
  ok: boolean,
  now: Date,
): { state: TelegramIncidentState | null; changed: boolean; event?: "down" | "up" } {
  if (!previous) {
    return ok
      ? { state: null, changed: false }
      : { state: { state: "down", since: now, notifiedAt: null }, changed: true };
  }

  if (ok) {
    if (previous.state === "up") return { state: previous, changed: false };
    if (previous.state === "down" && !previous.notifiedAt) {
      return { state: { state: "up", since: now, notifiedAt: null }, changed: true };
    }
    if (previous.state !== "recovering") {
      return { state: { state: "recovering", since: now, notifiedAt: previous.notifiedAt }, changed: true };
    }
    if (now.getTime() - previous.since.getTime() >= TELEGRAM_RECOVERY_DELAY_MS) {
      return { state: { state: "up", since: now, notifiedAt: null }, changed: true, event: "up" };
    }
    return { state: previous, changed: false };
  }

  if (previous.state === "up") {
    return { state: { state: "down", since: now, notifiedAt: null }, changed: true };
  }
  if (previous.state === "recovering") {
    return { state: { state: "alerted", since: now, notifiedAt: previous.notifiedAt }, changed: true };
  }
  if (previous.state === "down" && now.getTime() - previous.since.getTime() >= TELEGRAM_DOWN_DELAY_MS) {
    return { state: { state: "alerted", since: previous.since, notifiedAt: null }, changed: true, event: "down" };
  }
  return { state: previous, changed: false };
}
