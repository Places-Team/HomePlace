"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HomeIcon, ChartIcon, BoxIcon, BellIcon, SearchIcon, MediaIcon } from "./NavIcons";
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
    { href: "/media", label: d.nav.media, Icon: MediaIcon },
    { href: "/events", label: d.nav.events, Icon: BellIcon },
  ];

  return (
    <nav
      className="mobile-nav fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:hidden"
      aria-label={d.nav.dashboard}
    >
      <div className="flex items-center gap-1 rounded-full border border-line bg-surface/90 p-1.5 shadow-pop backdrop-blur-xl">
        {items.map(({ href, label, Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors ${
                active ? "bg-accent text-accent-fg" : "text-muted active:bg-raised"
              }`}
            >
              <Icon />
            </Link>
          );
        })}

        <span className="mx-0.5 h-6 w-px bg-line" aria-hidden />

        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("homeplace:palette"))}
          aria-label={d.common.search}
          className="flex h-11 w-11 items-center justify-center rounded-full text-muted transition-colors active:bg-raised"
        >
          <SearchIcon />
        </button>
      </div>
    </nav>
  );
}
