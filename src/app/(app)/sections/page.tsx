import Link from "next/link";
import { pageUser } from "@/lib/pageUser";
import { dict } from "@/i18n";
import { atLeast } from "@/lib/auth";
import { BoxIcon, BulbIcon, CalendarIcon, ChartIcon, DevicesIcon, EventsIcon, GearIcon, HomeIcon, MediaIcon, RequestsIcon, TransferIcon } from "@/components/NavIcons";

export default async function SectionsPage() {
  const user = await pageUser();
  const d = dict(user.locale);
  const canManage = atLeast(user.role, "admin");
  const groups = [
    { title: d.nav.system, links: [
      { href: "/", title: d.nav.dashboard, Icon: HomeIcon },
      { href: "/monitoring", title: d.nav.monitoring, Icon: ChartIcon },
      { href: "/containers", title: d.nav.containers, Icon: BoxIcon },
      { href: "/events", title: d.nav.events, Icon: EventsIcon },
      { href: "/settings", title: d.nav.settings, Icon: GearIcon },
    ] },
    { title: d.nav.services, links: [
      { href: "/home", title: d.nav.home, Icon: BulbIcon },
      { href: "/media", title: d.nav.media, Icon: MediaIcon },
      { href: "/media?tab=requests", title: d.nav.requests, Icon: RequestsIcon },
    ] },
    { title: d.nav.everyday, links: [
      { href: "/calendar", title: d.nav.plan, Icon: CalendarIcon },
    ] },
    { title: d.nav.sharing, links: [
      ...(canManage ? [
        { href: "/transfers", title: d.nav.transfers, Icon: TransferIcon },
        { href: "/devices", title: d.nav.devices, Icon: DevicesIcon },
      ] : []),
    ] },
  ].filter((group) => group.links.length > 0);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="border-b border-line pb-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent">HomePlace</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{d.nav.allSections}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">{d.nav.sectionsHint}</p>
      </header>
      <div className="grid gap-x-12 gap-y-8 md:grid-cols-2">
        {groups.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h2 className="mb-3 text-sm font-semibold text-muted">{group.title}</h2>
            <div className="border-t border-line">
              {group.links.map((link) => (
                <Link key={link.href} href={link.href} className="group flex min-h-14 items-center gap-4 border-b border-line py-3 transition-colors hover:text-accent focus-visible:text-accent">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-raised text-muted group-hover:text-accent"><link.Icon className="h-5 w-5" /></span>
                  <span className="flex-1 text-base font-medium">{link.title}</span>
                  <span aria-hidden className="text-lg text-faint transition-transform group-hover:translate-x-1 group-hover:text-accent">↗</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
