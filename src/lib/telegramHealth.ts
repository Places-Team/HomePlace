import "server-only";
import { prisma } from "./db";
import { telegramBotMonitors, telegramConfig, type TelegramBotMonitor } from "./integrations";
import { notify } from "./notify";
import { checkTelegramBot, type TelegramBotHealth } from "./telegram";

const CHECK_INTERVAL_MS = 60_000;
const DOWN_DELAY_MS = 90_000;
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
    const state = bot.ok ? "up" : "down";
    const previous = byId.get(itemId);
    if (!previous || previous.state !== state) {
      const recoveryShouldNotify = bot.ok && previous?.state === "down" && previous.notifiedAt !== null;
      await prisma.alertState.upsert({
        where: { itemId },
        update: { state, since: now, notifiedAt: null },
        create: { itemId, state, since: now },
      });
      await prisma.event.create({
        data: {
          type: "telegram-bot",
          severity: bot.ok ? "info" : "error",
          title: bot.ok ? `${bot.label} is available again` : `${bot.label} is unavailable`,
          detail: bot.ok ? bot.username ? `@${bot.username}` : null : bot.error?.slice(0, 300) ?? null,
        },
      });
      if (recoveryShouldNotify) {
        await notify({
          title: "Telegram bot recovered",
          body: `${bot.label}${bot.username ? ` (@${bot.username})` : ""} is available again.`,
          severity: "info",
          type: "telegram-bot",
          tag: itemId,
          respectQuietHours: false,
        });
      }
      continue;
    }

    if (bot.ok || previous.notifiedAt || now.getTime() - previous.since.getTime() < DOWN_DELAY_MS) continue;
    const delivered = await notify({
      title: "Telegram bot unavailable",
      body: `${bot.label} is not responding${bot.error ? `: ${bot.error}` : "."}`,
      severity: "error",
      type: "telegram-bot",
      tag: itemId,
      respectQuietHours: false,
    });
    const sent = delivered.suppressed || delivered.push > 0 || delivered.link > 0 || delivered.ntfy || delivered.webhook || delivered.email;
    if (sent) await prisma.alertState.update({ where: { itemId }, data: { notifiedAt: now } });
  }
}
