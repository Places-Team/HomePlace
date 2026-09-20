import "server-only";
import { ProxyAgent } from "undici";
import { socksDispatcher } from "fetch-socks";
import { telegramConfig, type TelegramSettings } from "./integrations";
import { inQuietHours } from "./quietHours";

/**
 * Telegram delivery.
 *
 * Two things make this less trivial than "POST to the Bot API". The first is
 * that plenty of home servers cannot reach Telegram directly and already run a
 * proxy for exactly that reason — so an optional proxy is a first-class option
 * here, not an afterthought. The second is quiet hours: a dashboard that wakes
 * you at 4am over a container that restarts itself gets muted within a week,
 * and a muted alerting system is worse than none.
 */

/**
 * Dispatcher for the proxy, if one is configured.
 *
 * Cached per proxy address, and that caching is the point. A tunnelled proxy —
 * a VPN client, typically — is often slow to establish the first connection and
 * fast on every one after it. A dispatcher built fresh for each message pays
 * that cost every time and times out; a kept one keeps the pool warm. The cache
 * is keyed by the URL, so changing the address in settings takes effect
 * immediately without a restart.
 *
 * The return type is deliberately loose: fetch-socks bundles its own copy of
 * undici, and the two Dispatcher types are structurally identical but not
 * interchangeable to TypeScript. Both are valid dispatchers at runtime.
 */
const dispatchers = new Map<string, unknown>();

function proxyDispatcher(proxyUrl: string): unknown {
  if (!proxyUrl) return undefined;
  const cached = dispatchers.get(proxyUrl);
  if (cached) return cached;

  try {
    const url = new URL(proxyUrl);
    // Generous connect timeout: the first hop through a VPN can take longer
    // than undici's ten-second default, and failing at that point looks to the
    // user like "the proxy is broken" when it merely needed a moment.
    const pool = { connectTimeout: 25_000, keepAliveTimeout: 60_000, keepAliveMaxTimeout: 300_000 };

    let dispatcher: unknown;
    if (url.protocol === "socks5:" || url.protocol === "socks:" || url.protocol === "socks5h:") {
      dispatcher = socksDispatcher(
        {
          type: 5,
          host: url.hostname,
          port: Number(url.port || 1080),
          userId: url.username || undefined,
          password: url.password || undefined,
        },
        pool
      );
    } else if (url.protocol === "http:" || url.protocol === "https:") {
      dispatcher = new ProxyAgent({ uri: proxyUrl, ...pool });
    } else {
      console.error(`unsupported telegram proxy scheme: ${url.protocol}`);
      return undefined;
    }

    dispatchers.set(proxyUrl, dispatcher);
    return dispatcher;
  } catch {
    console.error("TELEGRAM proxy URL is not a valid URL — ignoring it");
    return undefined;
  }
}

export type SendResult = { ok: boolean; error?: string };

export type TelegramBotHealth = {
  ok: boolean;
  username?: string;
  mode?: "polling" | "webhook";
  error?: string;
};

type TelegramApiEnvelope<T> = { ok?: boolean; result?: T; description?: string };

async function botApiWith<T>(
  cfg: Pick<TelegramSettings, "botToken" | "proxyUrl">,
  method: string,
): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(cfg.botToken)) return { ok: false, error: "invalid bot token format" };
  try {
    const response = await fetch(`https://api.telegram.org/bot${cfg.botToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
      // @ts-expect-error — undici's dispatcher option is not in the DOM types.
      dispatcher: proxyDispatcher(cfg.proxyUrl ?? ""),
    });
    const body = (await response.json().catch(() => null)) as TelegramApiEnvelope<T> | null;
    if (!response.ok || !body?.ok || body.result === undefined) {
      return { ok: false, error: body?.description?.slice(0, 200) || `Telegram API HTTP ${response.status}` };
    }
    return { ok: true, result: body.result };
  } catch (error) {
    return { ok: false, error: describeNetworkError(error, !!cfg.proxyUrl) };
  }
}

/** Verify a bot token and surface recent webhook delivery failures. */
export async function checkTelegramBot(
  cfg: Pick<TelegramSettings, "botToken" | "proxyUrl">,
): Promise<TelegramBotHealth> {
  const me = await botApiWith<{ username?: string }>(cfg, "getMe");
  if (!me.ok) return me;

  const webhook = await botApiWith<{
    url?: string;
    last_error_date?: number;
    last_error_message?: string;
  }>(cfg, "getWebhookInfo");
  if (!webhook.ok) return { ...webhook, username: me.result.username };

  const mode = webhook.result.url ? "webhook" : "polling";
  const recentError = Number(webhook.result.last_error_date ?? 0) * 1000 > Date.now() - 10 * 60_000;
  if (mode === "webhook" && recentError) {
    return {
      ok: false,
      username: me.result.username,
      mode,
      error: webhook.result.last_error_message?.slice(0, 200) || "Telegram reports a recent webhook delivery error",
    };
  }
  return { ok: true, username: me.result.username, mode };
}

/** Send a message with an explicit configuration — used by the "test" button. */
export async function sendWith(
  cfg: Pick<TelegramSettings, "botToken" | "chatId" | "proxyUrl">,
  text: string
): Promise<SendResult> {
  if (!cfg.botToken || !cfg.chatId) return { ok: false, error: "bot token or chat id is missing" };

  // Two attempts. Through a tunnel the first connection after an idle period
  // regularly hangs and the next one succeeds instantly — measured on a real
  // VPN, not guessed. A single attempt turns that into "notifications do not
  // work"; a retry turns it into a message that arrives a second late.
  let last: SendResult = { ok: false, error: "not attempted" };
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
    last = await attemptSend(cfg, text);
    // Only transport failures are worth repeating. A refusal from Telegram —
    // wrong token, unknown chat — will be refused just as firmly next time.
    if (last.ok || !/fetch failed|timeout|ECONN|ETIMEDOUT|ENOTFOUND|UND_ERR/i.test(last.error ?? "")) break;
  }
  return last;
}

async function attemptSend(
  cfg: Pick<TelegramSettings, "botToken" | "chatId" | "proxyUrl">,
  text: string
): Promise<SendResult> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: cfg.chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      cache: "no-store",
      // Long enough to cover a slow first hop plus the request itself.
      signal: AbortSignal.timeout(40_000),
      // @ts-expect-error — undici's dispatcher option is not in the DOM types.
      dispatcher: proxyDispatcher(cfg.proxyUrl ?? ""),
    });

    if (!res.ok) {
      // Telegram explains refusals in the body, and "chat not found" is by far
      // the most common one — worth surfacing verbatim.
      const body = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeNetworkError(e, !!cfg.proxyUrl) };
  }
}

/**
 * Turn "fetch failed" into something actionable.
 *
 * Node's fetch reports every transport problem as the same three words and
 * hides the real reason in `cause` — sometimes nested twice. On a home server
 * the answer is almost always "this network cannot reach Telegram", and the
 * fix is the proxy field, so say that instead of making someone read the
 * container log.
 */
function describeNetworkError(e: unknown, hasProxy: boolean): string {
  const parts: string[] = [];
  let current: unknown = e;
  for (let depth = 0; depth < 4 && current; depth++) {
    if (current instanceof Error) {
      const code = (current as NodeJS.ErrnoException).code;
      parts.push(code ? `${current.message} (${code})` : current.message);
      current = (current as { cause?: unknown }).cause;
    } else {
      parts.push(String(current));
      break;
    }
  }

  const detail = parts.join(" ← ");
  const looksBlocked = /fetch failed|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|UND_ERR/i.test(detail);

  if (looksBlocked && !hasProxy) {
    return `${detail} — the server cannot reach api.telegram.org. If your connection blocks it, set a SOCKS5 or HTTP proxy in the Proxy field.`;
  }
  if (/ECONNREFUSED/i.test(detail) && hasProxy) {
    // The common trap: a proxy running in another container that binds
    // 127.0.0.1 inside its own namespace. Publishing the port does not help —
    // Docker forwards the connection to the container's address, where nothing
    // is listening. Containers that share its network namespace reach it, and
    // everything else is refused, which looks like the proxy is down.
    return `${detail} — the address answered with "refused". If the proxy runs in another container, check that it listens on 0.0.0.0 and not on 127.0.0.1: a published port cannot reach a service bound to localhost inside its own container.`;
  }
  if (looksBlocked && hasProxy) {
    return `${detail} — the proxy did not connect. Check that the address is reachable from inside this container (a proxy on the host is not "localhost" here).`;
  }
  return detail;
}

/** Send using the saved configuration. No-op when Telegram is off. */
export async function send(text: string): Promise<SendResult> {
  const cfg = await telegramConfig();
  if (!cfg || !cfg.enabled) return { ok: false, error: "telegram is not enabled" };
  return sendWith(cfg, text);
}

/**
 * One Bot API call, through the configured proxy.
 *
 * The inbound side (the command bot) needs more than sendMessage — getUpdates,
 * and replies that carry a keyboard — so this is the general form the poller
 * uses. Returns the parsed `result`, or null on any failure, so a hiccup in the
 * bot never takes the monitor tick down with it.
 */
export async function tgApi<T = unknown>(method: string, body: Record<string, unknown>): Promise<T | null> {
  const cfg = await telegramConfig();
  if (!cfg?.botToken) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(40_000),
      // @ts-expect-error — undici's dispatcher option is not in the DOM types.
      dispatcher: proxyDispatcher(cfg.proxyUrl ?? ""),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok: boolean; result: T };
    return json.ok ? json.result : null;
  } catch (e) {
    console.error(`telegram ${method} failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Download a file a user sent — a photo, typically — as raw bytes.
 *
 * Two hops, both through the same proxy as everything else: getFile turns a
 * file id into a path, then the file endpoint serves the bytes. Returns null on
 * any failure, so a bad photo never disturbs the tick.
 */
export async function tgFetchFile(fileId: string): Promise<Buffer | null> {
  const cfg = await telegramConfig();
  if (!cfg?.botToken) return null;
  const file = await tgApi<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!file?.file_path) return null;
  try {
    const res = await fetch(`https://api.telegram.org/file/bot${cfg.botToken}/${file.file_path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(40_000),
      // @ts-expect-error — undici's dispatcher option is not in the DOM types.
      dispatcher: proxyDispatcher(cfg.proxyUrl ?? ""),
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    console.error("telegram file download failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Reply to one chat, optionally with a reply keyboard. */
export async function tgSend(chatId: string | number, text: string, keyboard?: string[][]): Promise<void> {
  await tgApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: { keyboard: keyboard.map((row) => row.map((t) => ({ text: t }))), resize_keyboard: true } } : {}),
  });
}

/** Send a message with inline buttons that call back with `data`. */
export async function tgSendInline(chatId: string | number, text: string, buttons: { text: string; data: string }[][]): Promise<void> {
  await tgApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) },
  });
}

/** Acknowledge a button tap so Telegram stops its spinner; optional toast. */
export async function tgAnswerCallback(id: string, text?: string): Promise<void> {
  await tgApi("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });
}

// Quiet hours live in their own module so they can be unit-tested without
// dragging the HTTP stack in; re-exported here because this is where callers
// expect to find them.
export { inQuietHours } from "./quietHours";
