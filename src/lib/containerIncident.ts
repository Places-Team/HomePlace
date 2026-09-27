/** A Docker state change must persist before it becomes a notification. */
export type ContainerIncidentState = {
  state: "up" | "pending" | "restarting" | "down";
  since: Date;
  notifiedAt: Date | null;
};

export const CONTAINER_DOWN_DELAY_MS = 5 * 60_000;

export type ContainerUptimeSnapshot = { id: string; seconds: number | null; at: number };

/** Docker's list endpoint includes a human-readable uptime, even without inspect access. */
export function dockerUptimeSeconds(status: string): number | null {
  if (/^Up less than a second/i.test(status)) return 0;
  const match = /^Up (\d+) (second|minute|hour|day|week|month|year)s?/i.exec(status);
  if (!match) return null;
  const unitSeconds: Record<string, number> = {
    second: 1,
    minute: 60,
    hour: 3600,
    day: 86400,
    week: 604800,
    month: 2592000,
    year: 31536000,
  };
  return Number(match[1]) * unitSeconds[match[2].toLowerCase()];
}

/** Detect a restart between probes, where the brief restarting state was missed. */
export function observedRestart(previous: ContainerUptimeSnapshot | undefined, current: ContainerUptimeSnapshot): boolean {
  if (!previous || current.at - previous.at > 24 * 60 * 60_000) return false;
  if (previous.id !== current.id) return true;
  return previous.seconds !== null && current.seconds !== null && previous.seconds >= 300 && current.seconds + 120 < previous.seconds;
}

export function nextContainerIncident(
  previous: ContainerIncidentState | null,
  problem: boolean,
  restarting: boolean,
  now: Date,
): { state: ContainerIncidentState; changed: boolean; event?: "down" | "up" | "restart" } {
  if (!previous) {
    return {
      state: { state: problem ? "pending" : "up", since: now, notifiedAt: null },
      changed: true,
    };
  }

  if (!problem) {
    if (previous.state === "up") return { state: previous, changed: false };
    return {
      state: { state: "up", since: now, notifiedAt: null },
      changed: true,
      event: previous.state === "down" ? "up" : previous.state === "restarting" ? "restart" : undefined,
    };
  }

  if (previous.state === "up") {
    return {
      state: { state: restarting ? "restarting" : "pending", since: now, notifiedAt: null },
      changed: true,
    };
  }
  if (previous.state === "down") return { state: previous, changed: false };
  if (now.getTime() - previous.since.getTime() >= CONTAINER_DOWN_DELAY_MS) {
    return {
      state: { state: "down", since: previous.since, notifiedAt: null },
      changed: true,
      event: "down",
    };
  }
  if (restarting && previous.state !== "restarting") {
    return { state: { ...previous, state: "restarting" }, changed: true };
  }
  return { state: previous, changed: false };
}
