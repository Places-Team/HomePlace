import Link from "next/link";
import { pageUser } from "@/lib/pageUser";
import { dict } from "@/i18n";
import { prisma } from "@/lib/db";
import { calendarEvents, linkedAccount } from "@/lib/google";
import { CalendarWorkspace } from "@/components/calendar/CalendarWorkspace";
import { RemindersWorkspace } from "@/components/calendar/RemindersWorkspace";
import { Card } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await pageUser();
  const d = dict(user.locale);
  const tab = (await searchParams).tab === "reminders" ? "reminders" : "calendar";
  const locale = user.locale === "ru" ? "ru-RU" : "en-US";

  let content: React.ReactNode;
  if (tab === "reminders") {
    const [active, completed] = await Promise.all([
      prisma.reminder.findMany({ where: { userId: user.id, done: false }, orderBy: { at: "asc" } }),
      prisma.reminder.findMany({ where: { userId: user.id, done: true }, orderBy: { completedAt: "desc" } }),
    ]);
    content = <RemindersWorkspace
      d={d}
      locale={locale}
      active={active.map((row) => ({ id: row.id, title: row.title, at: row.at.toISOString(), repeat: row.repeat, completedAt: null }))}
      completed={completed.map((row) => ({ id: row.id, title: row.title, at: row.at.toISOString(), repeat: row.repeat, completedAt: row.completedAt?.toISOString() ?? null }))}
    />;
  } else {
    const account = await linkedAccount(user.id);
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const to = new Date(now.getFullYear() + 1, now.getMonth() + 2, 1);
    const events = account ? await calendarEvents(user.id, from, to, 1500) : [];
    content = <div className="space-y-4">
      {!account && <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-line bg-surface px-4 py-3 text-sm text-muted">
        <span>{d.calendarPage.notLinked}</span>
        <Link href="/settings?section=integrations" className="rounded-control bg-accent px-3 py-2 font-medium text-accent-fg">{d.widgets.calendarLink}</Link>
      </div>}
      {events === null && <Card className="border-danger/30 p-4 text-sm text-danger">{d.calendarPage.loadFailed}</Card>}
      <CalendarWorkspace events={events ?? []} d={d} locale={locale} />
    </div>;
  }

  return <div className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">HomePlace</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{d.nav.plan}</h1>
      </div>
      <nav className="flex rounded-control border border-line bg-surface p-1" aria-label={d.nav.plan}>
        <Link href="/calendar" aria-current={tab === "calendar" ? "page" : undefined} className={`rounded-control px-4 py-2 text-sm font-medium ${tab === "calendar" ? "bg-accent text-accent-fg" : "text-muted hover:bg-raised hover:text-text"}`}>{d.calendarPage.title}</Link>
        <Link href="/calendar?tab=reminders" aria-current={tab === "reminders" ? "page" : undefined} className={`rounded-control px-4 py-2 text-sm font-medium ${tab === "reminders" ? "bg-accent text-accent-fg" : "text-muted hover:bg-raised hover:text-text"}`}>{d.plan.reminders}</Link>
      </nav>
    </header>
    {content}
  </div>;
}
