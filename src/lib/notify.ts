import "server-only";
import { getSetting, setSetting } from "./db";
import { decrypt, encrypt } from "./secretBox";
import { sendPush, alertRecipients } from "./push";
import { send as sendTelegram } from "./telegram";
import { inQuietHours } from "./quietHours";
import { telegramConfig } from "./integrations";
import { queueLinkNotifications } from "./linkDevices";
import { ntfyEndpoint, ntfyResponseError } from "./ntfyAddress";
import {
  NOTIFY_POLICY_KEY,
  normalizePolicy,
  shouldNotify,
  type NotifyPolicy,
  type Severity,
} from "./notifyPolicy";

/**
 * One place that decides where a notification goes.
 *
 * Four routes, each optional and each failing differently: push needs a browser
 * that once said yes, Telegram needs a network this server may not have, ntfy
 * needs nothing but the LAN, and a webhook is whatever the household already
 * runs. Sending to all of the configured ones is the point — the whole reason
 * an alert exists is that something is broken, and that is the worst moment to
 * depend on a single channel.
 */

export type NtfySettings = {
  enabled: boolean;
  /** Base URL of the server: https://ntfy.sh or a local one. */
  url: string;
  topic: string;
  /** Optional token for a protected topic. */
  token: string;
};

export type WebhookSettings = {
  enabled: boolean;
  url: string;
  /** Optional shared secret, sent as a bearer token. */
  token: string;
};

export type EmailSettings = {
  enabled: boolean;
  host: string;
  port: number;
  /** Implicit TLS (port 465). Off means plain or STARTTLS (587/25). */
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  /** One or more recipients, comma-separated. */
  to: string;
};

const KEY = { ntfy: "integration.ntfy", webhook: "integration.webhook", email: "integration.email" };

const NTFY_DEFAULTS: NtfySettings = { enabled: false, url: "https://ntfy.sh", topic: "", token: "" };
const WEBHOOK_DEFAULTS: WebhookSettings = { enabled: false, url: "", token: "" };

export async function ntfyConfig(): Promise<NtfySettings | null> {
  const stored = await getSetting<NtfySettings | null>(KEY.ntfy, null);
  if (!stored?.url || !stored.topic) return null;
  return { ...NTFY_DEFAULTS, ...stored, token: stored.token ? await decrypt(stored.token) : "" };
}

export async function saveNtfy(input: Partial<NtfySettings> & { clearToken?: boolean }): Promise<void> {
  const existing = await getSetting<NtfySettings | null>(KEY.ntfy, null);
  const { clearToken, ...settings } = input;
  await setSetting(KEY.ntfy, {
    ...NTFY_DEFAULTS,
    ...existing,
    ...settings,
    url: (input.url ?? existing?.url ?? "").trim().replace(/\/+$/, ""),
    topic: (input.topic ?? existing?.topic ?? "").trim(),
    // Empty keeps the stored token unless removal was explicitly requested.
    token: clearToken ? "" : input.token ? await encrypt(input.token) : existing?.token ?? "",
  });
}

const EMAIL_DEFAULTS: EmailSettings = { enabled: false, host: "", port: 587, secure: false, user: "", pass: "", from: "", to: "" };

export async function emailConfig(): Promise<EmailSettings | null> {
  const stored = await getSetting<EmailSettings | null>(KEY.email, null);
  if (!stored?.host || !stored.to) return null;
  return { ...EMAIL_DEFAULTS, ...stored, pass: stored.pass ? await decrypt(stored.pass) : "" };
}

export async function saveEmail(input: Partial<EmailSettings>): Promise<void> {
  const existing = await getSetting<EmailSettings | null>(KEY.email, null);
  await setSetting(KEY.email, {
    ...EMAIL_DEFAULTS,
    ...existing,
    ...input,
    host: (input.host ?? existing?.host ?? "").trim(),
    port: Number(input.port ?? existing?.port ?? 587) || 587,
    from: (input.from ?? existing?.from ?? "").trim(),
    to: (input.to ?? existing?.to ?? "").trim(),
    user: (input.user ?? existing?.user ?? "").trim(),
    // Empty means "keep the stored password", as with every other secret here.
    pass: input.pass ? await encrypt(input.pass) : existing?.pass ?? "",
  });
}

/**
 * Email, through the operator's own SMTP.
 *
 * Every other route is fire-and-forget over HTTP; email is the one that also
 * works when the household has nothing else — a relay on the LAN, or a provider
 * that only speaks SMTP. nodemailer handles the protocol; a `from` defaults to
 * the user when it is left blank.
 */
export async function sendEmail(cfg: EmailSettings, message: Notification): Promise<boolean> {
  try {
    const nodemailer = (await import("nodemailer")).default;
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
      // A home relay routinely carries a self-signed certificate.
      tls: { rejectUnauthorized: false },
    });
    await transport.sendMail({
      from: cfg.from || cfg.user,
      to: cfg.to,
      subject: message.title,
      text: message.body,
    });
    return true;
  } catch (e) {
    console.error("email delivery failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

export async function webhookConfig(): Promise<WebhookSettings | null> {
  const stored = await getSetting<WebhookSettings | null>(KEY.webhook, null);
  if (!stored?.url) return null;
  return { ...WEBHOOK_DEFAULTS, ...stored, token: stored.token ? await decrypt(stored.token) : "" };
}

export async function saveWebhook(input: Partial<WebhookSettings>): Promise<void> {
  const existing = await getSetting<WebhookSettings | null>(KEY.webhook, null);
  await setSetting(KEY.webhook, {
    ...WEBHOOK_DEFAULTS,
    ...existing,
    ...input,
    url: (input.url ?? existing?.url ?? "").trim(),
    token: input.token ? await encrypt(input.token) : existing?.token ?? "",
  });
}

export type Notification = {
  /** Omitted for infrastructure alerts; personal features opt into channels. */
  channels?: ("push" | "link" | "telegram" | "ntfy" | "webhook" | "email")[];
  title: string;
  body: string;
  /** Local destination opened when a browser or Link alert is selected. */
  url?: string;
  /** info | warn | error — decides the ntfy priority and the webhook field. */
  severity?: "info" | "warn" | "error";
  /**
   * The event kind this notification stands for (down, up, rule, restart…).
   * When set, the household's notification policy decides whether it is sent at
   * all — the event has already been recorded either way. Left unset (as
   * reminders do) it always sends: the policy only narrows the kinds it lists.
   */
  type?: string;
  /** Groups repeats of the same thing, so a flapping service replaces itself. */
  tag?: string;
  /** Whether quiet hours may swallow this. Reminders say no. */
  respectQuietHours?: boolean;
  /**
   * Restrict browser push and Link delivery to these users. Personal
   * reminders must not reach every administrator's devices.
   */
  recipientUserIds?: string[];
  /** A broken Telegram bot must not be used to announce its own outage. */
  skipTelegram?: boolean;
  /** Request high-priority delivery for a confirmed incident. */
  urgent?: boolean;
};

export type DeliveryResult = {
  push: number;
  link: number;
  telegram: boolean;
  ntfy: boolean;
  webhook: boolean;
  email: boolean;
  quiet: boolean;
  /** The policy withheld this kind of event from notifications. */
  suppressed: boolean;
};

export async function notifyPolicy(): Promise<NotifyPolicy> {
  return normalizePolicy(await getSetting(NOTIFY_POLICY_KEY, null));
}

/** Send to every configured route. Never throws — a notifier that can take the
 *  monitor down with it is worse than a missed message. */
export async function notify(message: Notification): Promise<DeliveryResult> {
  const channel = (name: NonNullable<Notification["channels"]>[number]) => !message.channels || message.channels.includes(name);
  const result: DeliveryResult = { push: 0, link: 0, telegram: false, ntfy: false, webhook: false, email: false, quiet: false, suppressed: false };
  const targetUrl = message.url?.startsWith("/") && !message.url.startsWith("//") ? message.url : "/";

  // The policy decides what a phone hears; the event has already been recorded.
  if (message.type) {
    const policy = await notifyPolicy();
    if (!shouldNotify(message.type, (message.severity as Severity) ?? "info", policy)) {
      result.suppressed = true;
      return result;
    }
  }

  const telegram = channel("telegram") || message.respectQuietHours !== false ? await telegramConfig() : null;
  if (message.respectQuietHours !== false && inQuietHours(telegram?.quietHours ?? "")) {
    result.quiet = true;
    return result;
  }

  const [ntfy, webhook, email] = await Promise.all([channel("ntfy") ? ntfyConfig() : null, channel("webhook") ? webhookConfig() : null, channel("email") ? emailConfig() : null]);

  const jobs: Promise<void>[] = [];

  const recipients = message.recipientUserIds ?? await alertRecipients();
  if (channel("push")) jobs.push(
    sendPush(recipients, { title: message.title, body: message.body, url: targetUrl, tag: message.tag, urgent: message.urgent })
      .then((r) => {
        result.push = r.sent;
      })
      .catch(() => {})
  );
  jobs.push(
    (channel("link") ? queueLinkNotifications(recipients, { title: message.title, body: message.body, url: targetUrl, tag: message.tag, urgent: message.urgent }) : Promise.resolve(0))
      .then((queued) => {
        result.link = queued;
      })
      .catch(() => {})
  );

  if (channel("telegram") && telegram?.enabled && !message.skipTelegram) {
    jobs.push(
      sendTelegram(`<b>${escapeHtml(message.title)}</b>\n${escapeHtml(message.body)}`)
        .then((r) => {
          result.telegram = r.ok;
        })
        .catch(() => {})
    );
  }

  if (channel("ntfy") && ntfy?.enabled) {
    jobs.push(
      sendNtfy(ntfy, message)
        .then((ok) => {
          result.ntfy = ok;
        })
        .catch(() => {})
    );
  }

  if (channel("webhook") && webhook?.enabled) {
    jobs.push(
      sendWebhook(webhook, message)
        .then((ok) => {
          result.webhook = ok;
        })
        .catch(() => {})
    );
  }

  if (channel("email") && email?.enabled) {
    jobs.push(
      sendEmail(email, message)
        .then((ok) => {
          result.email = ok;
        })
        .catch(() => {})
    );
  }

  await Promise.all(jobs);
  return result;
}

/**
 * ntfy.
 *
 * Worth having even though Telegram exists: a self-hosted ntfy lives on the
 * same LAN as the panel, so it keeps working when the internet does not — which
 * is precisely when a server alert matters.
 */
export async function sendNtfy(cfg: NtfySettings, message: Notification): Promise<boolean> {
  return (await deliverNtfy(cfg, message)).ok;
}

export async function deliverNtfy(cfg: NtfySettings, message: Notification): Promise<{ ok: boolean; error?: string }> {
  const endpoint = ntfyEndpoint(cfg.url, cfg.topic);
  if (!endpoint) return { ok: false, error: "The ntfy server URL or topic is invalid. Check the saved settings." };
  const priority = message.severity === "error" ? "high" : message.severity === "warn" ? "default" : "low";
  const tags = message.severity === "error" ? "rotating_light" : message.severity === "warn" ? "warning" : "information_source";

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        // Headers rather than JSON: ntfy's plain-body form is the one that works
        // on every version, including the ones packaged in distributions.
        title: encodeHeader(message.title),
        priority,
        tags,
        ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}),
      },
      body: message.body,
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: ntfyResponseError(res.status) };
  } catch (e) {
    console.error("ntfy delivery failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: "The HomePlace server could not reach ntfy or the request timed out. Check its address and network." };
  }
}

/** A POST with the whole event as JSON, for whatever the household runs. */
export async function sendWebhook(cfg: WebhookSettings, message: Notification): Promise<boolean> {
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}),
      },
      body: JSON.stringify({
        source: "homeplace",
        title: message.title,
        body: message.body,
        severity: message.severity ?? "info",
        tag: message.tag,
        at: new Date().toISOString(),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch (e) {
    console.error("webhook delivery failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * HTTP headers may only carry Latin-1, and a title is routinely Cyrillic.
 * ntfy decodes RFC 2047 words, which is the encoding that survives that.
 */
function encodeHeader(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** What the settings page shows: addresses visible, secrets masked. */
export async function notifiersForDisplay() {
  const [ntfy, webhook, email] = await Promise.all([ntfyConfig(), webhookConfig(), emailConfig()]);
  return {
    ntfy: {
      enabled: ntfy?.enabled ?? false,
      url: ntfy?.url ?? NTFY_DEFAULTS.url,
      topic: ntfy?.topic ?? "",
      hasToken: !!ntfy?.token,
    },
    webhook: {
      enabled: webhook?.enabled ?? false,
      url: webhook?.url ?? "",
      hasToken: !!webhook?.token,
    },
    email: {
      enabled: email?.enabled ?? false,
      host: email?.host ?? "",
      port: email?.port ?? EMAIL_DEFAULTS.port,
      secure: email?.secure ?? false,
      user: email?.user ?? "",
      from: email?.from ?? "",
      to: email?.to ?? "",
      hasPass: !!email?.pass,
    },
  };
}
