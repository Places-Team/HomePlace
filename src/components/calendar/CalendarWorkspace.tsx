"use client";

import { useMemo, useState } from "react";
import { Card, Badge } from "@/components/ui";
import type { CalendarEvent } from "@/lib/google";
import type { Dictionary } from "@/i18n";

type View = "month" | "week" | "agenda";

export function CalendarWorkspace({ events, d, locale }: { events: CalendarEvent[]; d: Dictionary; locale: string }) {
  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = events.find((event) => event.id === selectedId) ?? null;

  const title = view === "month"
    ? anchor.toLocaleDateString(locale, { month: "long", year: "numeric" })
    : view === "week"
      ? weekTitle(anchor, locale)
      : d.calendarPage.agenda;

  function move(direction: -1 | 1) {
    const next = new Date(anchor);
    if (view === "month") next.setMonth(next.getMonth() + direction, 1);
    else next.setDate(next.getDate() + direction * (view === "week" ? 7 : 30));
    setAnchor(startOfDay(next));
  }

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <button className="rounded-control border border-line px-3 py-1.5 text-sm hover:bg-raised" onClick={() => setAnchor(startOfDay(new Date()))}>
            {d.calendarPage.today}
          </button>
          <div className="flex items-center">
            <button className="rounded-control px-3 py-1.5 text-lg text-muted hover:bg-raised" onClick={() => move(-1)} aria-label={d.calendarPage.previous}>‹</button>
            <button className="rounded-control px-3 py-1.5 text-lg text-muted hover:bg-raised" onClick={() => move(1)} aria-label={d.calendarPage.next}>›</button>
          </div>
          <h2 className="min-w-[12rem] flex-1 text-base font-semibold capitalize">{title}</h2>
          <div className="flex rounded-control border border-line p-0.5">
            {(["month", "week", "agenda"] as View[]).map((kind) => (
              <button
                key={kind}
                onClick={() => setView(kind)}
                className={`rounded-[5px] px-3 py-1.5 text-xs font-medium ${view === kind ? "bg-accent text-accent-fg" : "text-muted hover:bg-raised"}`}
              >
                {d.calendarPage[kind]}
              </button>
            ))}
          </div>
        </div>

        {view === "month" && <MonthView events={events} anchor={anchor} locale={locale} selectedId={selectedId} onSelect={setSelectedId} />}
        {view === "week" && <WeekView events={events} anchor={anchor} locale={locale} selectedId={selectedId} onSelect={setSelectedId} d={d} />}
        {view === "agenda" && <AgendaView events={events} anchor={anchor} locale={locale} onSelect={setSelectedId} d={d} />}
      </Card>

      {selected && <EventDetails event={selected} d={d} locale={locale} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function MonthView({ events, anchor, locale, selectedId, onSelect }: { events: CalendarEvent[]; anchor: Date; locale: string; selectedId: string | null; onSelect: (id: string) => void }) {
  const cells = useMemo(() => monthCells(anchor), [anchor]);
  const byDay = useMemo(() => eventsByDay(events), [events]);
  const weekdays = weekdayNames(locale);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[700px]">
        <div className="grid grid-cols-7 border-b border-line bg-raised/50">
          {weekdays.map((name) => <div key={name} className="px-2 py-2 text-center text-[11px] font-medium uppercase text-faint">{name}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((date) => {
            const key = dayKey(date);
            const dayEvents = byDay.get(key) ?? [];
            const outside = date.getMonth() !== anchor.getMonth();
            const today = key === dayKey(new Date());
            return (
              <div key={key} className={`min-h-28 border-b border-r border-line p-1.5 ${outside ? "bg-raised/30 text-faint" : ""}`}>
                <div className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs ${today ? "bg-accent text-accent-fg" : ""}`}>{date.getDate()}</div>
                <div className="space-y-1">
                  {dayEvents.slice(0, 3).map((event) => (
                    <button key={event.id} onClick={() => onSelect(event.id)} className={`block w-full truncate rounded px-1.5 py-1 text-left text-[11px] ${selectedId === event.id ? "bg-accent text-accent-fg" : "bg-accent/10 text-text hover:bg-accent/20"}`}>
                      {!event.allDay && <span className="mr-1 font-mono text-faint">{time(event.start, locale)}</span>}{event.summary || "—"}
                    </button>
                  ))}
                  {dayEvents.length > 3 && <p className="px-1 text-[10px] text-faint">+{dayEvents.length - 3}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function WeekView({ events, anchor, locale, selectedId, onSelect, d }: { events: CalendarEvent[]; anchor: Date; locale: string; selectedId: string | null; onSelect: (id: string) => void; d: Dictionary }) {
  const start = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const byDay = eventsByDay(events);
  return (
    <div className="grid grid-cols-1 divide-y divide-line md:grid-cols-7 md:divide-x md:divide-y-0">
      {days.map((date) => {
        const list = byDay.get(dayKey(date)) ?? [];
        return <div key={dayKey(date)} className="min-h-56 p-2">
          <div className="mb-2 text-center"><p className="text-[11px] uppercase text-faint">{date.toLocaleDateString(locale, { weekday: "short" })}</p><p className="font-mono text-lg">{date.getDate()}</p></div>
          <div className="space-y-1.5">
            {list.length === 0 && <p className="text-center text-xs text-faint">{d.calendarPage.noEvents}</p>}
            {list.map((event) => <button key={event.id} onClick={() => onSelect(event.id)} className={`w-full rounded-control border p-2 text-left ${selectedId === event.id ? "border-accent bg-accent/10" : "border-line hover:bg-raised"}`}><p className="truncate text-xs font-medium">{event.summary || "—"}</p><p className="mt-0.5 font-mono text-[10px] text-faint">{event.allDay ? d.widgets.allDay : time(event.start, locale)}</p></button>)}
          </div>
        </div>;
      })}
    </div>
  );
}

function AgendaView({ events, anchor, locale, onSelect, d }: { events: CalendarEvent[]; anchor: Date; locale: string; onSelect: (id: string) => void; d: Dictionary }) {
  const end = addDays(anchor, 60);
  const visible = events.filter((event) => new Date(event.end) >= anchor && new Date(event.start) < end);
  const grouped = new Map<string, CalendarEvent[]>();
  for (const event of visible) {
    const key = dayKey(new Date(event.start));
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }
  return <div className="divide-y divide-line">
    {grouped.size === 0 && <p className="p-8 text-center text-sm text-muted">{d.calendarPage.noEvents}</p>}
    {[...grouped].map(([key, list]) => <section key={key} className="grid gap-2 p-3 sm:grid-cols-[10rem_1fr]"><h3 className="text-sm font-medium capitalize">{new Date(`${key}T12:00:00`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })}</h3><div className="space-y-1">{list.map((event) => <button key={event.id} onClick={() => onSelect(event.id)} className="flex w-full items-start gap-3 rounded-control px-3 py-2 text-left hover:bg-raised"><span className="w-14 shrink-0 font-mono text-xs text-faint">{event.allDay ? d.widgets.allDay : time(event.start, locale)}</span><span className="min-w-0"><span className="block truncate text-sm font-medium">{event.summary || "—"}</span>{event.location && <span className="block truncate text-xs text-faint">{event.location}</span>}</span></button>)}</div></section>)}
  </div>;
}

function EventDetails({ event, d, locale, onClose }: { event: CalendarEvent; d: Dictionary; locale: string; onClose: () => void }) {
  return <Card className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="mb-2 flex items-center gap-2"><h3 className="font-semibold">{event.summary || "—"}</h3>{event.allDay && <Badge>{d.widgets.allDay}</Badge>}</div><p className="text-sm text-muted">{eventRange(event, locale)}</p>{event.location && <p className="mt-1 text-sm">📍 {event.location}</p>}{event.description && <p className="mt-3 whitespace-pre-wrap text-sm text-muted">{event.description}</p>}{event.htmlLink && <a href={event.htmlLink} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-accent hover:underline">{d.calendarPage.openGoogle} ↗</a>}</div><button onClick={onClose} className="rounded-control px-2 py-1 text-muted hover:bg-raised" aria-label={d.common.close}>✕</button></div></Card>;
}

function monthCells(anchor: Date): Date[] { const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1); const start = addDays(first, -((first.getDay() + 6) % 7)); return Array.from({ length: 42 }, (_, index) => addDays(start, index)); }
function startOfWeek(date: Date): Date { return addDays(startOfDay(date), -((date.getDay() + 6) % 7)); }
function startOfDay(date: Date): Date { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function addDays(date: Date, amount: number): Date { const next = new Date(date); next.setDate(next.getDate() + amount); return next; }
function dayKey(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function time(value: string, locale: string): string { return new Date(value).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }); }
function weekdayNames(locale: string): string[] { const monday = new Date(2024, 0, 1); return Array.from({ length: 7 }, (_, index) => addDays(monday, index).toLocaleDateString(locale, { weekday: "short" })); }
function weekTitle(anchor: Date, locale: string): string { const start = startOfWeek(anchor); const end = addDays(start, 6); return `${start.toLocaleDateString(locale, { day: "numeric", month: "short" })} — ${end.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}`; }
function eventRange(event: CalendarEvent, locale: string): string { if (event.allDay) return new Date(event.start).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }); return `${new Date(event.start).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })} — ${new Date(event.end).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`; }
function eventsByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> { const map = new Map<string, CalendarEvent[]>(); for (const event of events) { const start = startOfDay(new Date(event.start)); const rawEnd = startOfDay(new Date(event.end)); const end = event.allDay ? addDays(rawEnd, -1) : rawEnd; for (let day = start; day <= end; day = addDays(day, 1)) { const key = dayKey(day); map.set(key, [...(map.get(key) ?? []), event]); } } return map; }
