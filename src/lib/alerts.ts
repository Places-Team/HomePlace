import "server-only";
import { prisma } from "./db";
import { telegramConfig } from "./integrations";
import { inQuietHours } from "./quietHours";
import { appUrl } from "./config";
import { notify } from "./notify";

/**
 * Turning probe results into notifications.
 *
 * The rule is deliberately dull: a tile has to stay down for the configured
 * delay before anything is sent, and exactly one message goes out per outage.
 * Most of what a home server does at 3am is restart itself successfully, and a
 * notifier that reports each of those becomes noise you learn to ignore.
 */

type Watched = { id: string; title: string; ok: boolean; error: string | null };

export async function processAlerts(current: Watched[]): Promise<void> {
  const cfg = await telegramConfig();
  const enabled = !!cfg?.enabled;

  const states = await prisma.alertState.findMany({ where: { itemId: { in: current.map((c) => c.id) } } });
  const stateBy = new Map(states.map((s) => [s.itemId, s]));
  const now = new Date();

  for (const item of current) {
    const previous = stateBy.get(item.id);
    const state = item.ok ? "up" : "down";

    // State changed: restart the clock and forget that we notified.
    if (!previous || previous.state !== state) {
      const wasNotifiedDown = previous?.state === "down" && previous.notifiedAt !== null;
      await prisma.alertState.upsert({
        where: { itemId: item.id },
        update: { state, since: now, notifiedAt: null },
        create: { itemId: item.id, state, since: now },
      });

      // Recovery is only worth a message if the outage itself was reported —
      // otherwise it announces the end of something nobody heard about.
      if (enabled && item.ok && wasNotifiedDown && cfg!.notifyRecovery) {
        await deliver(`✅ <b>${escapeHtml(item.title)}</b> is back online`, cfg!.quietHours, item.id, "up");
      }
      continue;
    }

    if (item.ok || previous.notifiedAt || !enabled) continue;

    const downFor = (now.getTime() - previous.since.getTime()) / 1000;
    if (downFor < cfg!.delaySeconds) continue;

    const detail = item.error ? `\n<code>${escapeHtml(item.error.slice(0, 200))}</code>` : "";
    const minutes = Math.round(downFor / 60);
    await deliver(
      `🔴 <b>${escapeHtml(item.title)}</b> is not responding` +
        (minutes >= 1 ? ` (${minutes} min)` : "") +
        detail +
        `\n${appUrl()}`,
      cfg!.quietHours,
      item.id,
      "down"
    );
  }
}

/**
 * Send, unless it is quiet hours.
 *
 * During quiet hours the alert is marked as handled without a message being
 * sent, rather than queued for the morning. A pile of overnight notifications
 * arriving at 08:00 about services that already recovered is precisely the
 * noise quiet hours exist to prevent; the event feed still has the full story.
 */
async function deliver(text: string, quietHours: string, itemId: string, state: "up" | "down"): Promise<void> {
  const quiet = inQuietHours(quietHours);
  if (!quiet) {
    // Every configured route at once. They fail differently — push needs a
    // browser, Telegram needs the outside world, ntfy needs only the LAN — and
    // an outage is the worst moment to depend on one of them.
    const delivered = await notify({
      title: state === "down" ? "⚠ HomePlace" : "✅ HomePlace",
      body: stripHtml(text),
      severity: state === "down" ? "error" : "info",
      type: state,
      tag: `item-${itemId}`,
    });

    // Nothing got through: leave it unmarked so the next tick tries again. A
    // policy that deliberately withheld the message is not a failure — it must
    // not make the loop retry forever.
    const anything =
      delivered.suppressed || delivered.push > 0 || delivered.link > 0 || delivered.telegram || delivered.ntfy || delivered.webhook || delivered.email;
    if (!anything && state === "down") return;
  }
  if (state === "down") {
    await prisma.alertState.update({ where: { itemId }, data: { notifiedAt: new Date() } }).catch(() => {});
  }
}

/** Push has no markup, so the Telegram formatting is taken back out. */
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
