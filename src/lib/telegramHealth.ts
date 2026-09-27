import "server-only";
import { prisma } from "./db";
import { telegramBotMonitors, telegramConfig, type TelegramBotMonitor } from "./integrations";
import { notify } from "./notify";
import { checkTelegramBot, type TelegramBotHealth } from "./telegram";
import { nextTelegramIncident, type TelegramIncidentState } from "./telegramIncident";

const CHECK_INTERVAL_MS = 60_000;
let nextCheckAt = 0;
let running = false;

type CheckedBot = TelegramBotHealth & { id: string; label: string };

/** Check the primary HomePlace bot plus every additional bot saved in Settings. */
export async function checkTelegramBotsDue(): Promise<void> {
  if (running || Date.now() < nextCheckAt) return;
  running = true;
  nextCheckAt = Date.now() + CHECK_INTERVAL_MS;
  try {
    const [primary, extra] = await Promise.all([telegramConfig(), telegramBotMonitors()]);
    const bots: TelegramBotMonitor[] = [
      ...(primary?.enabled
        ? [{ id: "homeplace", label: "HomePlace Telegram bot", enabled: true, botToken: primary.botToken, proxyUrl: primary.proxyUrl }]
        : []),
      ...extra.filter((bot) => bot.enabled),
    ];
    const unique = [...new Map(bots.map((bot) => [bot.botToken, bot])).values()];
    if (unique.length === 0) return;

    const checked: CheckedBot[] = await Promise.all(
      unique.map(async (bot) => ({ id: bot.id, label: bot.label, ...(await checkTelegramBot(bot)) })),
    );
    await processTelegramBotHealth(checked);
  } catch (error) {
    console.error("telegram bot health check failed:", error instanceof Error ? error.message : error);
  } finally {
    running = false;
  }
}

async function processTelegramBotHealth(checks: CheckedBot[]): Promise<void> {
  const keys = checks.map((bot) => `telegram-bot:${bot.id}`);
  const states = await prisma.alertState.findMany({ where: { itemId: { in: keys } } });
  const byId = new Map(states.map((state) => [state.itemId, state]));
  const now = new Date();

  for (const bot of checks) {
    const itemId = `telegram-bot:${bot.id}`;
    const previous = byId.get(itemId);
    const current: TelegramIncidentState | null = previous
      ? { state: previous.state, since: previous.since, notifiedAt: previous.notifiedAt }
      : null;
    const transition = nextTelegramIncident(current, bot.ok, now);
    if (transition.state && transition.changed) {
      await prisma.alertState.upsert({
        where: { itemId },
        update: transition.state,
        create: { itemId, ...transition.state },
      });
    }

    if (transition.event === "down") {
      await prisma.event.create({
        data: {
          type: "telegram-bot",
          severity: "error",
          title: `${bot.label} is unavailable`,
          detail: bot.error?.slice(0, 300) ?? "No response for at least five minutes.",
        },
      });
    } else if (transition.event === "up") {
      await prisma.event.create({
        data: {
          type: "telegram-bot",
          severity: "info",
          title: `${bot.label} is available again`,
          detail: bot.username ? `@${bot.username}` : null,
        },
      });
    }

    if (transition.state?.state === "alerted" && transition.state.notifiedAt === null) {
      const delivered = await notify({
        title: "Telegram bot unavailable",
        body: `${bot.label} has not responded for at least five minutes. Open HomePlace for details.`,
        severity: "error",
        type: "telegram-bot",
        tag: itemId,
        respectQuietHours: false,
        skipTelegram: true,
        urgent: true,
      });
      const sent = delivered.suppressed || delivered.push > 0 || delivered.link > 0 || delivered.ntfy || delivered.webhook || delivered.email;
      if (sent) await prisma.alertState.update({ where: { itemId }, data: { notifiedAt: now } });
    }
  }
}
