"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOut } from "@/actions/auth";
import { AppearanceMenu } from "./AppearanceMenu";
import { CommandPalette } from "./CommandPalette";
import { Help } from "./Help";
import { NotificationBell } from "./NotificationBell";
import type { Dictionary } from "@/i18n";

/**
 * The top bar. It is the only navigation in the panel: four destinations do not
 * justify a sidebar eating a fifth of the width on a laptop.
 */
export function AppNav({
  d,
  user,
  unread,
}: {
  d: Dictionary;
  user: { name: string; role: string; avatarUrl: string | null };
  unread: number;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const links = [
    { href: "/", label: d.nav.dashboard },
    { href: "/monitoring", label: d.nav.monitoring },
    { href: "/containers", label: d.nav.containers },
    { href: "/home", label: d.nav.home },
    { href: "/media", label: d.nav.media },
    ...(user.role === "viewer" ? [] : [{ href: "/devices", label: d.nav.devices }]),
    { href: "/events", label: d.nav.events },
  ];

  return (
    <header className="app-nav sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-1 px-4 sm:px-6">
        <Link href="/" className="mr-3 flex items-center gap-2 font-semibold tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center rounded-control bg-accent text-accent-fg text-sm">
            H
          </span>
          <span className="hidden sm:inline">HomePlace</span>
        </Link>

        {/* Hidden on a phone: those destinations live in the bottom pill. */}
        <nav className="hidden items-center gap-0.5 overflow-x-auto sm:flex">
          {links.map((link) => {
            // Exact match for the dashboard, prefix for the rest, so a detail
            // page still highlights its section.
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`whitespace-nowrap rounded-control px-3 py-1.5 text-sm font-medium transition-colors ${
                  active ? "bg-raised text-text" : "text-muted hover:bg-raised hover:text-text"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("homeplace:palette"))}
            title={`${d.common.search} · ${d.palette.hint}`}
            aria-label={d.common.search}
            className="hidden items-center gap-1.5 rounded-control px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-raised hover:text-text sm:flex"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <kbd className="hidden rounded border border-line px-1 font-mono text-[10px] text-faint lg:inline">
              {d.palette.hint}
            </kbd>
          </button>
          <NotificationBell d={d} initialUnread={unread} />
          <Help d={d} />
          <AppearanceMenu d={d} />
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-control px-2 py-1.5 text-sm text-muted transition-colors hover:bg-raised hover:text-text"
              aria-expanded={menuOpen}
            >
              {user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
              ) : (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-raised text-xs font-semibold text-text">
                  {user.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="hidden max-w-[10rem] truncate sm:inline">{user.name}</span>
            </button>

            {menuOpen && (
              <>
                {/* Click-away layer: cheaper and more predictable than listening
                    on document and fighting React's event ordering. */}
                <button
                  type="button"
                  aria-hidden
                  tabIndex={-1}
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-card border border-line bg-surface py-1 shadow-pop">
                  {user.role !== "viewer" && (
                    <Link
                      href="/devices"
                      onClick={() => setMenuOpen(false)}
                      className="block px-3 py-2 text-sm text-muted transition-colors hover:bg-raised hover:text-text sm:hidden"
                    >
                      {d.nav.devices}
                    </Link>
                  )}
                  <Link
                    href="/settings"
                    onClick={() => setMenuOpen(false)}
                    className="block px-3 py-2 text-sm text-muted transition-colors hover:bg-raised hover:text-text"
                  >
                    {d.nav.settings}
                  </Link>
                  <form action={signOut}>
                    <button
                      type="submit"
                      className="block w-full px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-raised hover:text-text"
                    >
                      {d.nav.signOut}
                    </button>
                  </form>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <CommandPalette d={d} />
    </header>
  );
}
