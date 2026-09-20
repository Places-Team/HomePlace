"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { requireRole } from "@/lib/auth";
import { setSetting, getSetting } from "@/lib/db";
import { savePrometheus, saveProxmox, saveTelegram, telegramConfig, saveDockerHosts, saveTelegramBotMonitors, telegramBotMonitors, type TelegramBotMonitor } from "@/lib/integrations";
import type { DockerHost } from "@/lib/config";
import { prometheusHealth } from "@/lib/prometheus";
import { proxmoxHealth } from "@/lib/proxmox";
import { checkTelegramBot, sendWith } from "@/lib/telegram";
import { saveGoogleConfig, unlinkAccount } from "@/lib/google";
import { saveFatSecret } from "@/lib/fatsecret";
import { saveNtfy, ntfyConfig, sendNtfy, saveWebhook, webhookConfig, sendWebhook, saveEmail, emailConfig, sendEmail, type EmailSettings } from "@/lib/notify";

/**
 * Configuring the integrations from the settings page.
 *
 * Each save is followed by a real request to the thing being configured, and
 * the result is what the page reports. "Saved" on its own is close to useless
 * here — the interesting question is never whether the string was written down,
 * it is whether the address and token actually work.
 */

export type TestResult = { ok: boolean; error?: string };

export async function saveFatSecretSettings(input: { clientId: string; secret: string }): Promise<TestResult> {
  await requireRole("admin");
  await saveFatSecret(input);
  revalidatePath("/settings");
  revalidatePath("/");
  return { ok: true };
}

export async function savePrometheusSettings(input: {
  url: string;
  username: string;
  password: string;
}): Promise<TestResult> {
  await requireRole("admin");
  await savePrometheus(input.url ? input : null);
  revalidatePath("/settings");
  revalidatePath("/monitoring");
  revalidatePath("/");
  if (!input.url) return { ok: true };
  return prometheusHealth();
}

export async function saveProxmoxSettings(input: {
  url: string;
  tokenId: string;
  tokenSecret: string;
  verifyTls: boolean;
}): Promise<TestResult> {
  await requireRole("admin");
  await saveProxmox(input.url ? input : null);
  revalidatePath("/settings");
  revalidatePath("/monitoring");
  revalidatePath("/");
  if (!input.url) return { ok: true };
  return proxmoxHealth();
}

export async function saveTelegramSettings(input: {
  enabled: boolean;
  botToken: string;
  chatId: string;
  delaySeconds: number;
  notifyRecovery: boolean;
  quietHours: string;
  proxyUrl: string;
}): Promise<TestResult> {
  await requireRole("admin");
  await saveTelegram(input);
  revalidatePath("/settings");
  return { ok: true };
}

export async function saveTelegramBotMonitorSettings(input: TelegramBotMonitor[]): Promise<TestResult> {
  await requireRole("admin");
  await saveTelegramBotMonitors(input);
  const bots = (await telegramBotMonitors()).filter((bot) => bot.enabled);
  const results = await Promise.all(bots.map(async (bot) => ({ bot, health: await checkTelegramBot(bot) })));
  revalidatePath("/settings");
  const failed = results.filter((result) => !result.health.ok);
  if (failed.length > 0) {
    return {
      ok: false,
      error: failed.map(({ bot, health }) => `${bot.label}: ${health.error ?? "unavailable"}`).join("; "),
    };
  }
  return { ok: true };
}

/** Send a real message, so "it works" means it arrived. */
/** Let the Telegram bot read commands (add reminders, ask status) from its chat. */
export async function setTelegramCommands(enabled: boolean): Promise<void> {
  await requireRole("admin");
  await setSetting("telegram.commands", enabled);
  revalidatePath("/settings");
}

export async function testTelegram(): Promise<TestResult> {
  await requireRole("admin");
  const cfg = await telegramConfig();
  if (!cfg) return { ok: false, error: "telegram is not configured" };
  return sendWith(cfg, "🏡 <b>HomePlace</b> — test message. Notifications are working.");
}

/**
 * The online icon pack.
 *
 * Off by default because it is the only thing in HomePlace that fetches from
 * the public internet. On a panel with a route out it turns a row of emoji into
 * real logos; on one without, leaving it off costs nothing — the built-in
 * emoji and the services' own favicons keep working.
 */
export async function setIconPack(enabled: boolean): Promise<void> {
  await requireRole("admin");
  await setSetting("icons.pack", enabled);
  revalidatePath("/");
  revalidatePath("/containers");
  revalidatePath("/settings");
}

/**
 * Token for the now-playing endpoint.
 *
 * Generated here rather than typed by a person: it is a shared secret between
 * the panel and a script on some other machine, and a memorable one would be a
 * guessable one.
 */
export async function rotateNowPlayingToken(): Promise<string> {
  await requireRole("admin");
  const token = randomBytes(24).toString("base64url");
  await setSetting("nowplaying.token", token);
  revalidatePath("/settings");
  return token;
}

export async function currentNowPlayingToken(): Promise<string> {
  await requireRole("admin");
  return getSetting<string>("nowplaying.token", "");
}

export async function disableNowPlaying(): Promise<void> {
  await requireRole("admin");
  await setSetting("nowplaying.token", "");
  await setSetting("nowplaying.state", null);
  revalidatePath("/settings");
}

/**
 * Google client credentials.
 *
 * Registered by whoever runs the panel, in their own Google Cloud project —
 * an OAuth client cannot be shipped with an open-source application, because
 * the secret would be in the repository and Google would revoke it.
 */
export async function saveGoogleSettings(input: { clientId: string; clientSecret: string }): Promise<TestResult> {
  await requireRole("admin");
  await saveGoogleConfig(input.clientId, input.clientSecret);
  revalidatePath("/settings");
  return { ok: true };
}

/** Forget the linked calendar for the signed-in account. */
export async function unlinkGoogle(): Promise<void> {
  const user = await requireRole("admin");
  await unlinkAccount(user.id);
  revalidatePath("/settings");
  revalidatePath("/");
}

/** ntfy — a notifier that works without leaving the house. */
export async function saveNtfySettings(input: {
  enabled: boolean;
  url: string;
  topic: string;
  token: string;
}): Promise<TestResult> {
  await requireRole("admin");
  await saveNtfy(input);
  revalidatePath("/settings");
  return { ok: true };
}

export async function testNtfy(): Promise<TestResult> {
  await requireRole("admin");
  const cfg = await ntfyConfig();
  if (!cfg) return { ok: false, error: "ntfy is not configured" };
  const ok = await sendNtfy(cfg, { title: "HomePlace", body: "Test notification — ntfy is working.", severity: "info" });
  return ok ? { ok: true } : { ok: false, error: "the server did not accept the message" };
}

/** A webhook, for whatever else the household runs. */
export async function saveWebhookSettings(input: { enabled: boolean; url: string; token: string }): Promise<TestResult> {
  await requireRole("admin");
  await saveWebhook(input);
  revalidatePath("/settings");
  return { ok: true };
}

export async function testWebhook(): Promise<TestResult> {
  await requireRole("admin");
  const cfg = await webhookConfig();
  if (!cfg) return { ok: false, error: "no webhook address" };
  const ok = await sendWebhook(cfg, { title: "HomePlace", body: "Test notification — the webhook is working.", severity: "info" });
  return ok ? { ok: true } : { ok: false, error: "the endpoint did not answer with a success status" };
}

/** Docker hosts added in the interface, on top of anything the .env fixes. */
export async function saveDockerHostsSettings(hosts: DockerHost[]): Promise<TestResult> {
  await requireRole("admin");
  await saveDockerHosts(hosts);
  revalidatePath("/settings");
  revalidatePath("/containers");
  revalidatePath("/");
  return { ok: true };
}

/** Email through the household's own SMTP server. */
export async function saveEmailSettings(input: Partial<EmailSettings>): Promise<TestResult> {
  await requireRole("admin");
  await saveEmail(input);
  revalidatePath("/settings");
  return { ok: true };
}

export async function testEmail(): Promise<TestResult> {
  await requireRole("admin");
  const cfg = await emailConfig();
  if (!cfg) return { ok: false, error: "email is not configured" };
  const ok = await sendEmail(cfg, { title: "HomePlace", body: "Test notification — email is working.", severity: "info" });
  return ok ? { ok: true } : { ok: false, error: "the SMTP server rejected the message" };
}
