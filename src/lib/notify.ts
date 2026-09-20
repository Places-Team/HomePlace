import "server-only";
import { getSetting, setSetting } from "./db";
import { decrypt, encrypt } from "./secretBox";
import { sendPush, alertRecipients } from "./push";
import { send as sendTelegram } from "./telegram";
import { inQuietHours } from "./quietHours";
import { telegramConfig } from "./integrations";
import { queueLinkNotifications } from "./linkDevices";
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

export async function saveNtfy(input: Partial<NtfySettings>): Promise<void> {
  const existing = await getSetting<NtfySettings | null>(KEY.ntfy, null);
  await setSetting(KEY.ntfy, {
    ...NTFY_DEFAULTS,
    ...existing,
    ...input,
    url: (input.url ?? existing?.url ?? "").trim().replace(/\/+$/, ""),
    topic: (input.topic ?? existing?.topic ?? "").trim(),
    // An empty field means "keep the stored token", as everywhere else.
    token: input.token ? await encrypt(input.token) : existing?.token ?? "",
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
  title: string;
  body: string;
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
   * Skip the push route. Used when the caller has already pushed to one
   * specific person — a reminder belongs to whoever set it, and pushing again
   * to every administrator would tell the household about someone's dentist.
   */
  skipPush?: boolean;
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
  const result: DeliveryResult = { push: 0, link: 0, telegram: false, ntfy: false, webhook: false, email: false, quiet: false, suppressed: false };

  // The policy decides what a phone hears; the event has already been recorded.
  if (message.type) {
    const policy = await notifyPolicy();
    if (!shouldNotify(message.type, (message.severity as Severity) ?? "info", policy)) {
      result.suppressed = true;
      return result;
    }
  }

  const telegram = await telegramConfig();
  if (message.respectQuietHours !== false && inQuietHours(telegram?.quietHours ?? "")) {
    result.quiet = true;
    return result;
  }

  const [ntfy, webhook, email] = await Promise.all([ntfyConfig(), webhookConfig(), emailConfig()]);

  const jobs: Promise<void>[] = [];

  if (!message.skipPush) {
    const recipients = await alertRecipients();
    jobs.push(
      sendPush(recipients, { title: message.title, body: message.body, tag: message.tag })
        .then((r) => {
          result.push = r.sent;
        })
        .catch(() => {})
    );
    jobs.push(
      queueLinkNotifications(recipients, { title: message.title, body: message.body, tag: message.tag })
        .then((queued) => {
          result.link = queued;
        })
        .catch(() => {})
    );
  }

  if (telegram?.enabled) {
    jobs.push(
      sendTelegram(`<b>${escapeHtml(message.title)}</b>\n${escapeHtml(message.body)}`)
        .then((r) => {
          result.telegram = r.ok;
        })
        .catch(() => {})
    );
  }

  if (ntfy?.enabled) {
    jobs.push(
      sendNtfy(ntfy, message)
        .then((ok) => {
          result.ntfy = ok;
        })
        .catch(() => {})
    );
  }

  if (webhook?.enabled) {
    jobs.push(
      sendWebhook(webhook, message)
        .then((ok) => {
          result.webhook = ok;
        })
        .catch(() => {})
    );
  }

  if (email?.enabled) {
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
  const priority = message.severity === "error" ? "high" : message.severity === "warn" ? "default" : "low";
  const tags = message.severity === "error" ? "rotating_light" : message.severity === "warn" ? "warning" : "information_source";

  try {
    const res = await fetch(`${cfg.url}/${encodeURIComponent(cfg.topic)}`, {
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
    return res.ok;
  } catch (e) {
    console.error("ntfy delivery failed:", e instanceof Error ? e.message : e);
    return false;
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
  // eslint-disable-next-line no-control-regex
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
