export const LINK_CALENDAR_EVENT_LIMIT = 250;

export type LinkCalendarEvent = {
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
};

type CalendarCandidate = {
  id?: unknown;
  summary?: unknown;
  start?: unknown;
  end?: unknown;
  allDay?: unknown;
  location?: unknown;
};

/** Keep the Link calendar response small and independent from Google payloads. */
export function normalizeLinkCalendarEvents(value: unknown): LinkCalendarEvent[] {
  if (!Array.isArray(value)) return [];

  const events: LinkCalendarEvent[] = [];
  for (const raw of value.slice(0, LINK_CALENDAR_EVENT_LIMIT)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as CalendarCandidate;
    const id = safeIdentifier(item.id);
    const allDay = item.allDay === true;
    const start = safeDate(item.start, allDay);
    const end = safeDate(item.end, allDay);
    if (!id || !start || !end || Date.parse(end) < Date.parse(start)) continue;

    const summary = safeText(item.summary, 300) ?? "";
    const location = safeText(item.location, 300);
    events.push({ id, summary, start, end, allDay, ...(location ? { location } : {}) });
  }
  return events;
}

function safeIdentifier(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(value) ? value : null;
}

function safeDate(value: unknown, allDay: boolean): string | null {
  if (typeof value !== "string") return null;
  if (allDay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function safeText(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return Array.from(text).slice(0, limit).join("");
}
