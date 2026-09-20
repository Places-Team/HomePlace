import { Card, CardHeader } from "@/components/ui";
import { upcomingEvents, linkedAccount } from "@/lib/google";
import { CalendarGrid } from "./CalendarGrid";
import type { Dictionary } from "@/i18n";

/**
 * A calendar that looks like a calendar.
 *
 * The first version was a list of the next few events, which answers "what is
 * next" but not "how does this week look" — and the second question is the one
 * a wall calendar exists for. This draws the month, marks the days that have
 * something on them, and lists whatever is on the selected day underneath.
 *
 * Personal by construction: it reads the calendar of whoever is looking — and a
 * calendar is a calendar with or without one. Google is an optional source of
 * marks on the days, not the reason the widget exists: unlinked, the month is
 * still drawn and still browsable, with a quiet offer to connect an account.
 */
export async function CalendarWidget({
  config,
  title,
  d,
  userId,
}: {
  config: Record<string, unknown>;
  title: string;
  d: Dictionary;
  userId: string;
}) {
  const account = await linkedAccount(userId);

  // A month of events rather than a handful: the grid needs to know which days
  // are busy, and a day cannot be marked from a list of the next eight things.
  const events = account ? await upcomingEvents(userId, 45, 250) : null;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        title={title}
        action={
          account ? (
            <a href="/calendar" className="text-[11px] text-accent hover:underline">
              {d.calendarPage.open}
            </a>
          ) : (
            <a
              href="/settings?section=integrations"
              className="shrink-0 text-[11px] text-muted transition-colors hover:text-accent"
              title={d.widgets.calendarNotLinked}
            >
              {d.widgets.calendarLink}
            </a>
          )
        }
      />
      <CalendarGrid
        d={d}
        events={(events ?? []).map((e) => ({
          id: e.id,
          summary: e.summary,
          start: e.start,
          end: e.end,
          allDay: e.allDay,
          location: e.location,
        }))}
        showList={config.list !== false}
      />
    </Card>
  );
}
