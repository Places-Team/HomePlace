import Link from "next/link";
import { pageUser } from "@/lib/pageUser";
import { dict } from "@/i18n";
import { atLeast } from "@/lib/auth";

export default async function SectionsPage() {
  const user = await pageUser();
  const d = dict(user.locale);
  const canManage = atLeast(user.role, "admin");
  const groups = [
    { title: d.nav.everyday, links: [
      { href: "/", title: d.nav.dashboard, mark: "01" },
      { href: "/calendar", title: d.nav.plan, mark: "02" },
      { href: "/media?tab=requests", title: d.nav.requests, mark: "03" },
    ] },
    { title: d.nav.sharing, links: [
      ...(canManage ? [
        { href: "/transfers", title: d.nav.transfers, mark: "04" },
        { href: "/devices", title: d.nav.devices, mark: "05" },
      ] : []),
    ] },
    { title: d.nav.services, links: [
      { href: "/media", title: d.nav.media, mark: "06" },
      { href: "/home", title: d.nav.home, mark: "07" },
    ] },
    { title: d.nav.system, links: [
      { href: "/monitoring", title: d.nav.monitoring, mark: "08" },
      { href: "/containers", title: d.nav.containers, mark: "09" },
      { href: "/events", title: d.nav.events, mark: "10" },
      { href: "/settings", title: d.nav.settings, mark: "11" },
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
                  <span className="w-6 shrink-0 font-mono text-xs tabular-nums text-faint">{link.mark}</span>
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
