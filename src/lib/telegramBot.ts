import "server-only";
import { prisma, getSetting, setSetting } from "./db";
import { telegramConfig } from "./integrations";
import { tgApi, tgSend, tgSendInline, tgAnswerCallback, tgFetchFile } from "./telegram";
import { decodeBarcodeFromJpeg } from "./barcodeDecode";
import { listContainers, controlContainer } from "./docker";
import { addShopping, getShopping } from "./shopping";
import { haToggle } from "./services";
import { sendWol } from "./wol";
import { extractRepeat, repeatLabel } from "./recurrence";
import { foodSearch, foodByBarcode } from "./food";
import type { FoodMatch } from "./fatsecret";
import { dict } from "@/i18n";

/**
 * The Telegram command bot.
 *
 * Outbound already works; this is the way back in. Rather than a webhook — which
 * a home server behind NAT cannot receive — it long-polls getUpdates on the
 * monitor tick, so the only traffic is outbound, the same as the rest of the
 * panel. It answers only the one chat the integration is configured for, and
 * everything it creates belongs to the owner account.
 *
 * What it does today: add reminders in plain language, list them, and answer a
 * status question. The parser is forgiving — "Buy bread tomorrow 18:00" and
 * "Купить хлеб | завтра 18:00" both work — and anything it cannot read gets a
 * one-line example back rather than silence.
 */

const OFFSET_KEY = "telegram.offset";
const state = new Map<string, "reminder" | "shopping" | "food">(); // chatId → what the next message is

const MENU = [
  ["➕ Напоминание", "🛒 В список"],
  ["🍎 Еда", "📋 Напоминания"],
  ["📊 Статус"],
];

let looping = false;

/**
 * A long-polling loop, started once with the server.
 *
 * The bot used to be checked on the 10-second monitor tick with a non-blocking
 * getUpdates, so an answer could lag by up to a tick — which is what "the bot is
 * slow" was, not the proxy. Long polling holds one request open for up to 25
 * seconds and returns the instant a message lands, so replies are as fast as the
 * round-trip. It is one held connection at a time — fewer requests than polling,
 * not more. When Telegram or its command mode is off, it idles and re-checks.
 */
export function startTelegramPolling(): void {
  if (looping) return;
  looping = true;
  void pollLoop();
}

async function pollLoop(): Promise<void> {
  for (;;) {
    try {
      const active = await pollTelegram(25);
      // Not configured / commands off: back off so the loop is not a busy-wait.
      if (!active) await sleep(15_000);
    } catch (e) {
      console.error("telegram poll loop error:", e);
      await sleep(5_000); // transient network trouble — retry after a breath
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * One round of getUpdates. Returns false when the bot is not active (so the loop
 * can idle), true otherwise. `longPollSeconds` is passed to Telegram, which then
 * holds the request until a message arrives or the time is up.
 */
export async function pollTelegram(longPollSeconds = 0): Promise<boolean> {
  const cfg = await telegramConfig();
  if (!cfg?.enabled) return false;
  if (!(await getSetting<boolean>("telegram.commands", false))) return false;

  const offset = (await getSetting<number>(OFFSET_KEY, 0)) || 0;
  const updates = await tgApi<TgUpdate[]>("getUpdates", { offset: offset + 1, timeout: longPollSeconds, allowed_updates: ["message", "callback_query"] });
  if (!updates || updates.length === 0) return true;

  await setSetting(OFFSET_KEY, updates[updates.length - 1].update_id);

  for (const u of updates) {
    try {
      if (u.callback_query) {
        const cb = u.callback_query;
        const chatId = cb.message?.chat?.id;
        if (chatId === undefined || String(chatId) !== String(cfg.chatId)) continue;
        await handleCallback(String(chatId), cb);
        continue;
      }
      const msg = u.message;
      if (!msg?.chat) continue;
      // Only the configured chat is trusted — anyone else is a stranger with the
      // bot's username, and this is a control surface.
      if (String(msg.chat.id) !== String(cfg.chatId)) continue;
      if (msg.text) await handle(String(msg.chat.id), msg.text.trim());
      else if (msg.photo?.length) await handlePhoto(String(msg.chat.id), msg.photo);
    } catch (e) {
      console.error("telegram command failed:", e);
    }
  }
  return true;
}

/** A tapped inline button: pick a food from a list, or tick a reminder off. */
async function handleCallback(chatId: string, cb: { id: string; data?: string }): Promise<void> {
  await tgAnswerCallback(cb.id);
  const data = cb.data ?? "";

  if (data.startsWith("food:")) {
    const pending = foodChoices.get(chatId);
    const chosen = pending?.items[Number(data.slice(5))];
    if (pending && chosen) {
      foodChoices.delete(chatId);
      await logFoodMatch(chatId, chosen, pending.grams);
    }
    return;
  }
  if (data.startsWith("done:")) {
    const ok = await completeReminderById(data.slice(5));
    await tgSend(chatId, ok ? "✅ Отмечено выполненным." : "Напоминание не найдено.");
    return;
  }
}

/** Tick a reminder off — repeating ones move to their next time, like the web. */
async function completeReminderById(id: string): Promise<boolean> {
  const r = await prisma.reminder.findUnique({ where: { id } });
  if (!r) return false;
  if (r.repeat === "none") {
    await prisma.reminder.update({ where: { id }, data: { done: true, completedAt: new Date() } });
  } else {
    const { nextOccurrence } = await import("./recurrence");
    await prisma.reminder.update({ where: { id }, data: { at: nextOccurrence(r.at, r.repeat), notifiedAt: null } });
  }
  return true;
}

/**
 * A photo is treated as a barcode to look up — "throw a picture of the packet
 * at the bot". The largest size is decoded server-side; a hit is logged to the
 * diary at 100 g, and anything unreadable asks for a clearer shot or the number.
 */
async function handlePhoto(chatId: string, photos: { file_id: string }[]): Promise<void> {
  const largest = photos[photos.length - 1];
  const buf = await tgFetchFile(largest.file_id);
  if (!buf) {
    await tgSend(chatId, "Не удалось скачать фото. Попробуйте ещё раз.");
    return;
  }
  const code = decodeBarcodeFromJpeg(buf);
  if (!code) {
    await tgSend(chatId, "Не разглядел штрихкод на фото. Сфотографируйте ближе и ровнее — или пришлите цифры под кодом.");
    return;
  }

  const res = await foodByBarcode(code);
  if (res.error) {
    await tgSend(chatId, foodErrorText(res.error));
    return;
  }
  const match = res.foods.find((f) => f.per100);
  if (!match) {
    await tgSend(chatId, `Штрихкод <code>${escape(code)}</code> не нашёлся в базе. Попробуйте по названию.`);
    return;
  }
  await logFoodMatch(chatId, match, 100);
}

async function handle(chatId: string, text: string): Promise<void> {
  const lower = text.toLowerCase();

  // "Done" leaves whatever mode we are in.
  if (/^\/(done)|^готово$|^меню$|^menu$/.test(lower)) {
    state.delete(chatId);
    await tgSend(chatId, "Готово.", MENU);
    return;
  }

  // Shopping mode: every line becomes an item until "готово".
  if (state.get(chatId) === "shopping" && !/^\//.test(lower) && !/список|статус/.test(lower)) {
    await addShopping(text);
    await tgSend(chatId, `🛒 Добавлено: <b>${escape(text)}</b>. Ещё? Или «Готово».`);
    return;
  }

  // Food mode: every line is a food to look up and log until "готово".
  if (state.get(chatId) === "food" && !/^\//.test(lower) && !/список|статус|напомин/.test(lower)) {
    await handleFood(chatId, text);
    return;
  }

  if (/^\/(food|eat)|^🍎|^еда$|дневник еды/.test(lower)) {
    state.set(chatId, "food");
    await tgSend(
      chatId,
      "Что съели? Напишите продукт, можно с граммами: «банан 150», «овсянка», пришлите цифры штрихкода или фото штрихкода. «Готово» — закончить." +
        `\n\n${await todayFoodLine()}`
    );
    return;
  }

  if (/^\/(shop|buy)|список покупок|^🛒|в список/.test(lower)) {
    state.set(chatId, "shopping");
    const items = await getShopping();
    const open = items.filter((i) => !i.done);
    const list = open.length > 0 ? "\n\n" + open.map((i) => `• ${escape(i.text)}`).join("\n") : "";
    await tgSend(chatId, `Пишите товары — по одному в сообщении. «Готово» — закончить.${list}`);
    return;
  }

  if (/^\/(start|help)|^меню$|^menu$/.test(lower)) {
    state.delete(chatId);
    await tgSend(
      chatId,
      "Напишите напоминание, например:\n" +
        "• «Купить хлеб завтра 18:00»\n" +
        "• «Полить цветы каждые 2 дня»\n" +
        "• «Зарядка каждый день 8:00»\n" +
        "• «Оплатить интернет 25.12 10:00 каждый месяц»\n\n" +
        "🍎 «Еда» — записать съеденное (по названию, граммам или штрихкоду).\n" +
        "🛒 «В список» — добавить покупки.\n\n" +
        "Команды:\n/restart &lt;имя&gt; — перезапустить контейнер\n/scene &lt;entity&gt; — запустить сцену\n/wake &lt;MAC&gt; — разбудить ПК",
      MENU
    );
    return;
  }
  if (/^\/status|статус/.test(lower)) {
    state.delete(chatId);
    await tgSend(chatId, await statusText(), MENU);
    return;
  }

  // Control commands: /restart <name>, /scene <entity>, /wake <mac>.
  const restart = /^\/restart\s+(.+)$/i.exec(text);
  if (restart) {
    state.delete(chatId);
    await tgSend(chatId, await restartContainer(restart[1].trim()));
    return;
  }
  const scene = /^\/scene\s+(\S+)/i.exec(text);
  if (scene) {
    state.delete(chatId);
    const r = await haToggle(scene[1]);
    await tgSend(chatId, r.ok ? `▶️ Запущено: <b>${escape(scene[1])}</b>` : `⚠ ${escape(r.error ?? "ошибка")}`);
    return;
  }
  const wake = /^\/wake\s+([0-9a-f:\-]+)/i.exec(text);
  if (wake) {
    state.delete(chatId);
    const r = await sendWol(wake[1]);
    await tgSend(chatId, r.ok ? `⏻ Magic-пакет отправлен на ${escape(wake[1])}` : `⚠ ${escape(r.error ?? "ошибка")}`);
    return;
  }
  if (/^\/list|^📋/.test(lower)) {
    state.delete(chatId);
    await sendRemindersList(chatId);
    return;
  }
  if (/^\/remind|^➕/.test(lower)) {
    state.set(chatId, "reminder");
    await tgSend(chatId, "Напишите напоминание и время. Например: «Позвонить маме завтра 19:30», «Полить цветы каждые 2 дня» или «Оплатить интернет | 25.12 10:00 каждый месяц».");
    return;
  }

  // Free text: treat as a reminder, whether or not it was asked for.
  const parsed = parseReminder(text);
  if (!parsed) {
    await tgSend(chatId, "Не понял время. Пример: «Купить хлеб завтра 18:00» или «Текст | 25.12 10:00».", MENU);
    return;
  }
  state.delete(chatId);
  await createReminder(parsed);
  const when = parsed.at.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const rep = parsed.repeat !== "none" ? ` · ${repeatLabel(parsed.repeat, dict("ru")).toLowerCase()}` : "";
  // No time was written and a relative day was assumed — say when, and invite a
  // precise time instead.
  const hint = parsed.assumedTime ? "\n<i>Время не указано — поставил через 24 часа. Хотите иначе — допишите время, например «18:00».</i>" : "";
  await tgSend(chatId, `✅ Добавлено: <b>${escape(parsed.title)}</b> — ${when}${rep}${hint}`, MENU);
}

/** The account the bot acts as — its reminders and its food diary belong here. */
async function ownerId(): Promise<string | null> {
  const owner =
    (await prisma.user.findFirst({ where: { role: "owner" }, orderBy: { createdAt: "asc" }, select: { id: true } })) ??
    (await prisma.user.findFirst({ where: { role: "admin" }, orderBy: { createdAt: "asc" }, select: { id: true } })) ??
    (await prisma.user.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }));
  return owner?.id ?? null;
}

async function createReminder(r: { title: string; at: Date; repeat: string }): Promise<void> {
  const id = await ownerId();
  if (!id) return;
  await prisma.reminder.create({ data: { userId: id, title: r.title, at: r.at, repeat: r.repeat } });
}

// ─────────────────────────────── Food diary ──────────────────────────────

/**
 * Look a food up and write it to the diary.
 *
 * A line is "<food> <grams>" — "банан 150" — or just a name (100 g assumed), or
 * a run of digits, which is treated as a barcode. FatSecret answers the same way
 * it does on the web, allow-list and all, so a blocked IP is reported here too.
 */
/** Foods offered as a numbered choice, waiting for the user to pick one. */
const foodChoices = new Map<string, { items: FoodMatch[]; grams: number }>();

async function handleFood(chatId: string, text: string): Promise<void> {
  // Picking a number from a list we just offered.
  const pending = foodChoices.get(chatId);
  const asNum = /^\s*(\d{1,2})\s*$/.exec(text);
  if (pending && asNum) {
    const chosen = pending.items[Number(asNum[1]) - 1];
    foodChoices.delete(chatId);
    if (chosen) {
      await logFoodMatch(chatId, chosen, pending.grams);
      return;
    }
    await tgSend(chatId, "Такого номера нет. Напишите продукт заново.");
    return;
  }
  foodChoices.delete(chatId);

  const bare = text.replace(/\s+/g, "");
  const isBarcode = /^\d{6,14}$/.test(bare);

  let query = text.trim();
  let grams = 100;
  if (!isBarcode) {
    const m = text.match(/^(.*?)[\s,]+(\d{1,4})\s*(г|гр|грамм\w*|g)?$/i);
    if (m) {
      query = m[1].trim();
      grams = Math.max(1, Number(m[2]) || 100);
    }
  }

  const res = isBarcode ? await foodByBarcode(bare) : await foodSearch(query);
  if (res.error) {
    await tgSend(chatId, foodErrorText(res.error));
    return;
  }
  const withMacros = res.foods.filter((f) => f.per100);
  if (withMacros.length === 0) {
    await tgSend(chatId, isBarcode ? "Штрихкод не найден. Попробуйте по названию." : "Не нашёл. Уточните название или добавьте вручную на сайте.");
    return;
  }

  // A barcode or a single hit goes straight in; several by name become a choice.
  if (isBarcode || withMacros.length === 1) {
    await logFoodMatch(chatId, withMacros[0], grams);
    return;
  }

  const items = withMacros.slice(0, 6);
  foodChoices.set(chatId, { items, grams });
  const list = items.map((f, i) => `${i + 1}. ${escape(f.name)} — ${f.per100!.kcal} ккал/100 г`).join("\n");
  // Inline buttons 1..N so a tap picks it — the number still works as a reply.
  const buttons = [items.map((_, i) => ({ text: String(i + 1), data: `food:${i}` }))];
  await tgSendInline(chatId, `Нашёл несколько${grams !== 100 ? ` (на ${grams} г)` : ""} — выберите:\n${list}`, buttons);
}

/** Write one match to the diary and confirm with the day's running total. */
async function logFoodMatch(chatId: string, match: FoodMatch, grams: number): Promise<void> {
  if (!match.per100) return;
  const id = await ownerId();
  if (!id) return;
  const f = grams / 100;
  const kcal = Math.round(match.per100.kcal * f);
  const protein = round1(match.per100.protein * f);
  const fat = round1(match.per100.fat * f);
  const carbs = round1(match.per100.carbs * f);
  await prisma.foodLog.create({ data: { userId: id, name: match.name.slice(0, 120), kcal, protein, fat, carbs, grams } });

  await tgSend(
    chatId,
    `🍎 Записано: <b>${escape(match.name)}</b> — ${grams} г · ${kcal} ккал (Б${protein} Ж${fat} У${carbs})\n\n${await todayFoodLine()}`
  );
}

/** One line: today's running total, for the owner's diary. */
async function todayFoodLine(): Promise<string> {
  const id = await ownerId();
  if (!id) return "";
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const rows = await prisma.foodLog.findMany({ where: { userId: id, at: { gte: start } }, select: { kcal: true, protein: true, fat: true, carbs: true } });
  if (rows.length === 0) return "Сегодня пока пусто.";
  const sum = rows.reduce((a, r) => ({ kcal: a.kcal + r.kcal, protein: a.protein + r.protein, fat: a.fat + r.fat, carbs: a.carbs + r.carbs }), { kcal: 0, protein: 0, fat: 0, carbs: 0 });
  return `📊 Сегодня: <b>${Math.round(sum.kcal)}</b> ккал · Б${Math.round(sum.protein)} Ж${Math.round(sum.fat)} У${Math.round(sum.carbs)}`;
}

function foodErrorText(error: string): string {
  if (error.startsWith("ip:")) return `⚠ FatSecret отклонил IP сервера (${escape(error.slice(3) || "—")}). Добавьте его в белый список в аккаунте FatSecret.`;
  if (error === "auth" || error === "not-configured") return "⚠ FatSecret не настроен или недоступен. Проверьте ключи в настройках.";
  return "⚠ Ошибка FatSecret. Попробуйте ещё раз.";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

async function sendRemindersList(chatId: string): Promise<void> {
  const rows = await prisma.reminder.findMany({ where: { done: false }, orderBy: { at: "asc" }, take: 10 });
  if (rows.length === 0) {
    await tgSend(chatId, "Напоминаний нет.", MENU);
    return;
  }
  const text = rows
    .map((r) => `• ${escape(r.title)} — ${r.at.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`)
    .join("\n");
  // One ✓ button per reminder — a tap ticks it off (repeating ones roll forward).
  const buttons = rows.map((r) => [{ text: `✓ ${r.title.slice(0, 24)}`, data: `done:${r.id}` }]);
  await tgSendInline(chatId, text, buttons);
}

async function restartContainer(name: string): Promise<string> {
  const c = (await listContainers()).find((x) => x.name === name);
  if (!c) return `⚠ Контейнер «${escape(name)}» не найден`;
  const r = await controlContainer(c.hostKey, c.id, "restart");
  return r.ok ? `🔁 Перезапущен: <b>${escape(name)}</b>` : `⚠ ${escape(r.error ?? "ошибка")}`;
}

async function statusText(): Promise<string> {
  try {
    const containers = await listContainers();
    const running = containers.filter((c) => c.state === "running").length;
    const problems = containers.filter((c) => c.state === "restarting" || c.state === "dead" || c.health === "unhealthy");
    let out = `📦 Контейнеры: ${running}/${containers.length} работают`;
    if (problems.length > 0) out += `\n⚠ Проблемы: ${problems.slice(0, 8).map((p) => escape(p.name)).join(", ")}`;
    return out;
  } catch {
    return "Статус недоступен.";
  }
}

// ───────────────────────────── Time parsing ──────────────────────────────

/** Pull a title, a moment and a repeat out of a plain-language line. */
export function parseReminder(input: string): { title: string; at: Date; repeat: string; assumedTime: boolean } | null {
  let text = input.trim();
  if (text.includes("|")) {
    // Explicit form: "text | when" — parse the two halves separately.
    const [t, w] = text.split("|");
    const when = parseWhen(w);
    const title = t.trim();
    return when && title ? { title, at: when.at, repeat: when.repeat, assumedTime: when.assumedTime } : null;
  }

  const now = new Date();
  const d = new Date(now);
  d.setSeconds(0, 0);
  let found = false;
  let timeSet = false;
  // A relative day ("завтра") with no clock time means the same time tomorrow —
  // exactly 24 hours out — rather than a made-up 09:00. A calendar date is
  // different: there the morning is the sensible default.
  let relativeDay = false;

  // Repeat first, in either language and either spelling — "каждые два дня",
  // "every 3 hours", "ежедневно". Handled by the shared parser so the widget
  // and the bot always agree on what a cadence means.
  const rep = extractRepeat(text);
  let repeat = rep.repeat;
  if (repeat !== "none") {
    text = rep.text;
    found = true;
  }

  const strip = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    const m = text.match(re);
    if (!m) return;
    fn(m);
    text = text.replace(re, " ");
    found = true;
  };

  // `\b` is ASCII-only in JS and never matches next to Cyrillic, so these use
  // explicit letter classes and space anchors instead.
  strip(/(?:^|\s)(через|in)\s+(\d+)\s*(мин[а-яё]*|м|min[a-z]*|час[а-яё]*|ч|h|hours?|дн[а-яё]*|день|d|days?)/i, (m) => {
    const n = Number(m[2]);
    const u = m[3].toLowerCase();
    const ms = /^(мин|м|min)/.test(u) ? 60_000 : /^(час|ч|h)/.test(u) ? 3_600_000 : 86_400_000;
    d.setTime(now.getTime() + n * ms);
    d.setSeconds(0, 0);
    timeSet = true;
  });

  strip(/(послезавтра|день после завтра)/i, () => { d.setDate(now.getDate() + 2); relativeDay = true; });
  strip(/(завтра|tomorrow)/i, () => { d.setDate(now.getDate() + 1); relativeDay = true; });
  strip(/(сегодня|today)/i, () => {});

  strip(/\b(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?\b/, (m) => {
    d.setMonth(Number(m[2]) - 1, Number(m[1]));
    if (m[3]) d.setFullYear(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]));
  });

  strip(/\b(\d{1,2}):(\d{2})\b/, (m) => {
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    timeSet = true;
  });
  if (!timeSet) {
    strip(/(?:^|\s)(?:в|at)\s+(\d{1,2})(?:\s*(час[а-яё]*|ч|h))?(?:\s|$)/i, (m) => {
      d.setHours(Number(m[1]), 0, 0, 0);
      timeSet = true;
    });
  }

  if (!found) return null;

  // "завтра" with no time is exactly a day out, keeping the current clock time;
  // a bare calendar date with no time falls back to the morning.
  let assumedTime = false;
  if (!timeSet) {
    if (relativeDay) {
      assumedTime = true; // same time tomorrow — flag it so the reply can say so
    } else {
      d.setHours(9, 0, 0, 0);
    }
  }
  if (d < now) d.setDate(d.getDate() + 1); // a time already past today is tomorrow's

  const title = text.replace(/\s+/g, " ").replace(/^[\s|·,-]+|[\s|·,-]+$/g, "").trim();
  return title ? { title, at: d, repeat, assumedTime } : null;
}

function parseWhen(str: string): { at: Date; repeat: string; assumedTime: boolean } | null {
  const parsed = parseReminder(`placeholder ${str}`);
  return parsed ? { at: parsed.at, repeat: parsed.repeat, assumedTime: parsed.assumedTime } : null;
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type TgUpdate = {
  update_id: number;
  message?: { text?: string; chat?: { id: number }; photo?: { file_id: string }[] };
  callback_query?: { id: string; data?: string; message?: { chat?: { id: number } } };
};
