export type PlantNotificationSettings = {
  enabled: boolean;
  app: boolean;
  telegram: boolean;
  time: string;
  timeZone: string;
  /** Zero sends once per watering cycle; otherwise repeat every N days. */
  repeatDays: number;
};
export const DEFAULT_PLANT_SETTINGS: PlantNotificationSettings = {
  enabled: true,
  app: true,
  telegram: false,
  time: "09:00",
  timeZone: "UTC",
  repeatDays: 1,
};
export function validPlantTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
export function normalizePlantSettings(
  input: unknown,
): PlantNotificationSettings {
  const value =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
    app: typeof value.app === "boolean" ? value.app : true,
    telegram: value.telegram === true,
    time:
      typeof value.time === "string" &&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)
        ? value.time
        : "09:00",
    timeZone:
      typeof value.timeZone === "string" &&
      value.timeZone.length <= 80 &&
      validPlantTimeZone(value.timeZone)
        ? value.timeZone
        : "UTC",
    repeatDays:
      typeof value.repeatDays === "number" &&
      Number.isInteger(value.repeatDays) &&
      value.repeatDays >= 0 &&
      value.repeatDays <= 30
        ? value.repeatDays
        : 1,
  };
}
const formatters = new Map<string, Intl.DateTimeFormat>();
function localClock(
  date: Date,
  timeZone: string,
): { day: number; minutes: number } {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    if (formatters.size >= 100) formatters.clear();
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    day:
      Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) /
      86_400_000,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}
export function plantReminderSlot(
  plant: {
    intervalDays: number;
    lastWateredAt: Date;
    remindersEnabled: boolean;
    deletedAt: Date | null;
  },
  settings: PlantNotificationSettings,
  now: Date,
): string | null {
  if (
    !settings.enabled ||
    (!settings.app && !settings.telegram) ||
    !plant.remindersEnabled ||
    plant.deletedAt ||
    !Number.isFinite(plant.lastWateredAt.getTime())
  )
    return null;
  const watered = localClock(plant.lastWateredAt, settings.timeZone);
  const clock = localClock(now, settings.timeZone);
  const [hour, minute] = settings.time.split(":").map(Number);
  const latestDay = clock.day - (clock.minutes < hour * 60 + minute ? 1 : 0);
  const dueDay = watered.day + plant.intervalDays;
  if (latestDay < dueDay) return null;
  const slot =
    settings.repeatDays === 0
      ? dueDay
      : dueDay +
        Math.floor((latestDay - dueDay) / settings.repeatDays) *
          settings.repeatDays;
  return new Date(slot * 86_400_000).toISOString().slice(0, 10);
}

export function plantWateringState(
  plant: { intervalDays: number; lastWateredAt: Date },
  timeZone: string,
  now: Date,
) {
  const dueDay =
    localClock(plant.lastWateredAt, timeZone).day + plant.intervalDays;
  return {
    dueDate: new Date(dueDay * 86_400_000).toISOString().slice(0, 10),
    daysUntil: dueDay - localClock(now, timeZone).day,
  };
}

/** A shared, bounded message for browser, Link and Telegram delivery. */
export function plantReminderMessage(
  plants: { name: string; location: string }[],
  locale: string,
) {
  const ru = locale === "ru";
  const title = ru ? `Пора полить растения (${plants.length})` : `Plants need watering (${plants.length})`;
  const footer = ru ? "Отметьте полив в HomePlace." : "Mark watered in HomePlace.";
  const lines: string[] = [];
  for (const plant of plants) {
    const line = `• ${plant.name}${plant.location ? ` — ${plant.location}` : ""}`;
    if ([...lines, line, footer].join("\n").length > 1800) break;
    lines.push(line);
  }
  if (lines.length < plants.length) lines.push(ru ? `И ещё ${plants.length - lines.length}.` : `And ${plants.length - lines.length} more.`);
  return { title, body: [...lines, "", footer].join("\n"), url: "/plants" };
}
