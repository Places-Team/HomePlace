import Link from "next/link";
import { pageUser } from "@/lib/pageUser";
import { dict } from "@/i18n";
import { calendarEvents, linkedAccount } from "@/lib/google";
import { CalendarWorkspace } from "@/components/calendar/CalendarWorkspace";
import { Card } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const user = await pageUser();
  const d = dict(user.locale);
  const account = await linkedAccount(user.id);
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const to = new Date(now.getFullYear() + 1, now.getMonth() + 2, 1);
  const events = account ? await calendarEvents(user.id, from, to, 1500) : [];

  return <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-2"><div><h1 className="text-lg font-semibold tracking-tight">{d.calendarPage.title}</h1><p className="mt-0.5 text-sm text-muted">{account?.email ?? d.calendarPage.notLinked}</p></div>{!account && <Link href="/settings?section=integrations" className="rounded-control bg-accent px-3 py-2 text-sm font-medium text-accent-fg">{d.widgets.calendarLink}</Link>}</div>
    {events === null && <Card className="border-danger/30 p-4 text-sm text-danger">{d.calendarPage.loadFailed}</Card>}
    <CalendarWorkspace events={events ?? []} d={d} locale={user.locale === "ru" ? "ru-RU" : "en-US"} />
  </div>;
}
