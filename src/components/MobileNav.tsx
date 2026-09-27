"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HomeIcon, ChartIcon, BoxIcon, BulbIcon, MediaIcon, SectionsIcon } from "./NavIcons";
import type { Dictionary } from "@/i18n";

/**
 * The bar at the bottom of a phone screen.
 *
 * A floating pill rather than a full-width bar: it sits where a thumb already
 * is, leaves the page visible around it, and does not pretend to be part of the
 * browser chrome. Above `sm` it disappears entirely — a laptop has the top bar,
 * and two navigations would be one too many.
 *
 * The bottom padding uses the safe-area inset so the pill clears the home
 * indicator on an iPhone instead of sitting under it.
 */
export function MobileNav({ d }: { d: Dictionary }) {
  const pathname = usePathname();

  const items = [
    { href: "/", label: d.nav.dashboard, Icon: HomeIcon },
    { href: "/monitoring", label: d.nav.monitoring, Icon: ChartIcon },
    { href: "/containers", label: d.nav.containers, Icon: BoxIcon },
    { href: "/home", label: d.nav.home, Icon: BulbIcon },
    { href: "/media", label: d.nav.media, Icon: MediaIcon },
    { href: "/sections", label: d.nav.allSections, Icon: SectionsIcon },
  ];

  return (
    <nav
      className="mobile-nav fixed inset-x-0 bottom-0 z-40 flex justify-center px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden"
      aria-label={d.nav.allSections}
    >
      <div className="flex max-w-full items-center gap-0.5 rounded-full border border-line bg-surface/95 p-1.5 shadow-pop backdrop-blur-xl">
        {items.map(({ href, label, Icon }) => {
          const path = href.split("?")[0];
          const active = path === "/" ? pathname === "/" : pathname.startsWith(path);
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${
                active ? "bg-accent text-accent-fg" : "text-muted active:bg-raised"
              }`}
            >
              <Icon />
            </Link>
          );
        })}

      </div>
    </nav>
  );
}
