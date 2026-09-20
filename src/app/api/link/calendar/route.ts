import { NextResponse } from "next/server";
import {
  createCalendarEvent,
  calendarEvents,
  deleteCalendarEvent,
  linkedAccount,
  updateCalendarEvent,
  type CalendarEventInput,
} from "@/lib/google";
import { normalizeLinkCalendarEvents } from "@/lib/linkCalendar";
import { authorizeMobile } from "@/lib/linkMobile";
import { boundedJson, checkDeviceActionRateLimit } from "@/lib/linkRequest";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeMobile(request, "calendar.read");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const account = await linkedAccount(auth.device.userId);
  if (!account) {
    return NextResponse.json(
      { status: "not_connected", events: [] },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const range = calendarRange(request);
  if (!range) return NextResponse.json({ error: "invalid calendar range" }, { status: 400 });
  const calendar = await calendarEvents(auth.device.userId, range.from, range.to, 250);
  return NextResponse.json(
    {
      status: calendar === null ? "unavailable" : "connected",
      events: normalizeLinkCalendarEvents(calendar),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

function calendarRange(request: Request): { from: Date; to: Date } | null {
  const url = new URL(request.url);
  const fromValue = url.searchParams.get("from");
  const toValue = url.searchParams.get("to");
  const from = fromValue ? new Date(fromValue) : new Date();
  const to = toValue ? new Date(toValue) : new Date(Date.now() + 60 * 86400_000);
  const duration = to.getTime() - from.getTime();
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || duration <= 0 || duration > 93 * 86400_000) {
    return null;
  }
  return { from, to };
}

export async function POST(request: Request) {
  const auth = await authorizeMobile(request, "calendar.manage");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const rate = checkDeviceActionRateLimit(auth.device.id, "calendar-manage", 30);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "too many calendar changes" },
      { status: 429, headers: { "retry-after": String(rate.retryAfterSeconds ?? 60) } },
    );
  }

  const body = await boundedJson(request);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid calendar request" }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const action = input.action;
  const eventId = safeEventId(input.id);
  let ok = false;

  if (action === "delete" && eventId) {
    ok = await deleteCalendarEvent(auth.device.userId, eventId);
  } else if (action === "create" || (action === "update" && eventId)) {
    const event = safeEventInput(input);
    if (!event) return NextResponse.json({ error: "invalid calendar event" }, { status: 400 });
    ok = action === "create"
      ? await createCalendarEvent(auth.device.userId, event)
      : await updateCalendarEvent(auth.device.userId, eventId!, event);
  } else {
    return NextResponse.json({ error: "unsupported calendar action" }, { status: 400 });
  }

  if (!ok) {
    return NextResponse.json(
      { error: "calendar change was rejected; reconnect Google Calendar and try again" },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}

function safeEventId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(value) ? value : null;
}

function safeEventInput(value: Record<string, unknown>): CalendarEventInput | null {
  const summary = safeText(value.summary, 300);
  const location = safeText(value.location, 300);
  const allDay = value.allDay === true;
  if (!summary || typeof value.start !== "string" || typeof value.end !== "string") return null;

  const start = normalizeDate(value.start, allDay);
  const end = normalizeDate(value.end, allDay);
  if (!start || !end || Date.parse(end) <= Date.parse(start)) return null;
  return { summary, start, end, allDay, ...(location ? { location } : {}) };
}

function normalizeDate(value: string, allDay: boolean): string | null {
  if (allDay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || Array.from(text).length > maximum || /[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}
