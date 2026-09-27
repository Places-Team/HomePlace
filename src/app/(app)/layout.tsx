import { redirect } from "next/navigation";
import { needsSetup } from "@/lib/auth";
import { currentUser } from "@/lib/session";
import { dict } from "@/i18n";
import { AppNav } from "@/components/AppNav";
import { MobileNav } from "@/components/MobileNav";
import { startMonitor } from "@/lib/monitor";
import { unreadFor } from "@/lib/notifications";
import { atLeast } from "@/lib/auth";
import { availableHomePlaceUpdate } from "@/lib/updates";
import { UpdateNotice } from "@/components/UpdateNotice";

export const dynamic = "force-dynamic";

/**
 * The shell every signed-in page lives in.
 *
 * Authentication is enforced here rather than in middleware: middleware runs on
 * the edge runtime with no database, so it could only guess from the presence
 * of a cookie. This layout resolves the real account, and everything below it
 * can assume a user exists.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Idempotent: the first signed-in page render of a process starts the prober,
  // every later one is a no-op.
  startMonitor();

  if (await needsSetup()) redirect("/setup");
  const user = await currentUser();
  if (!user) redirect("/login");

  const d = dict(user.locale);
  const [unread, update] = await Promise.all([
    unreadFor(user.id),
    atLeast(user.role, "admin") ? availableHomePlaceUpdate() : Promise.resolve(null),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main-content" className="sr-only focus:fixed focus:left-4 focus:top-2 focus:z-50 focus:not-sr-only focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:text-text">
        {d.nav.skipContent}
      </a>
      <AppNav d={d} user={{ name: user.name, role: user.role, avatarUrl: user.avatarUrl }} unread={unread} />
      {update && <UpdateNotice d={d} update={update} />}
      {/* The bottom padding is for the floating navigation on a phone: without
          it the last tile ends up underneath the pill. The pill sits a safe-area
          inset above the screen edge and is ~56px tall, so the clearance has to
          account for the inset too — a fixed value alone leaves the last card
          under the bar on tall, notched phones. */}
      <main id="main-content" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:px-6 lg:pb-6">{children}</main>

      {/* Deliberately a sibling of the header, not a child of it. `position:
          fixed` is positioned against the nearest ancestor with a filter,
          transform or backdrop-filter — and the header has backdrop-blur, which
          is why the bar rendered stuck to the bottom of the *header* instead of
          the bottom of the screen. */}
      <MobileNav d={d} canShare={atLeast(user.role, "admin")} />
    </div>
  );
}
