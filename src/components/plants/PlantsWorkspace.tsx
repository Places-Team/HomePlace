"use client";
/* eslint-disable @next/next/no-img-element -- Private photos require the browser's authenticated request. */
import { useEffect, useRef, useState } from "react";
import { PlantIcon, GearIcon } from "../NavIcons";
import type { PlantNotificationSettings } from "@/lib/plantCare";
import { validPlantTimeZone } from "@/lib/plantCare";
import { plantWateringState } from "@/lib/plantCare";
import { MAX_PLANT_PHOTO_BYTES } from "@/lib/plantPhoto";

type Plant = {
  clientId: string;
  name: string;
  species: string;
  location: string;
  notes: string;
  intervalDays: number;
  lastWateredAt: string;
  remindersEnabled: boolean;
  revision: number;
  deletedAt: string | null;
  photo: { url: string; version: string } | null;
};
const field =
  "w-full rounded-control border border-line bg-bg px-3 py-2.5 text-base text-text focus:border-accent focus:outline-none";
const button =
  "rounded-control border border-line px-3 py-2 text-sm font-medium transition-colors hover:bg-raised disabled:opacity-50";
export function PlantsWorkspace({
  now,
  ru,
  initialPlants,
  initialSettings,
  telegramReady,
  focusId,
  pending,
}: {
  now: string;
  ru: boolean;
  initialPlants: Plant[];
  initialSettings: PlantNotificationSettings;
  telegramReady: boolean;
  focusId?: string;
  pending: number;
}) {
  const [plants, setPlants] = useState(initialPlants);
  const [settings, setSettings] = useState(initialSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<Plant | "new" | null>(null);
  const [onlyDue, setOnlyDue] = useState(false);
  const [clock, setClock] = useState(now);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (editing !== null && dialog.current && !dialog.current.open)
      dialog.current.showModal();
  }, [editing]);
  useEffect(() => {
    const controller = new AbortController();
    let fetching = false;
    async function refresh() {
      if (document.hidden || busy || editing !== null || fetching) return;
      fetching = true;
      try {
        const response = await fetch("/api/link/plants", {
          signal: controller.signal,
        });
        const result = await response.json();
        if (
          response.ok &&
          !controller.signal.aborted &&
          Array.isArray(result.plants)
        ) {
          setPlants(result.plants.filter((plant: Plant) => !plant.deletedAt));
          if (!settingsOpen && result.settings) setSettings(result.settings);
          setClock(result.serverTime ?? new Date().toISOString());
        }
      } catch {
        /* A background refresh preserves the last usable snapshot. */
      } finally {
        fetching = false;
      }
    }
    const onFocus = () => void refresh();
    const timer = setInterval(onFocus, 60_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [busy, editing, settingsOpen]);
  const say = (en: string, russian: string) => (ru ? russian : en);
  const displayZone = validPlantTimeZone(settings.timeZone)
    ? settings.timeZone
    : initialSettings.timeZone;
  async function request(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 409 && result.plant)
        setPlants((current) =>
          current.map((plant) =>
            plant.clientId === result.plant.clientId ? result.plant : plant,
          ),
        );
      throw new Error(
        response.status === 409
          ? say(
              "Updated on another device. Review the latest version and try again.",
              "Изменено на другом устройстве. Проверьте свежую версию и повторите действие.",
            )
          : say(
              "Could not save. Check the connection and try again.",
              "Не удалось сохранить. Проверьте подключение и повторите.",
            ),
      );
    }
    return result;
  }
  async function mutate(input: Record<string, unknown>) {
    const result = await request("/api/link/plants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (result.plant)
      setPlants((current) =>
        result.plant.deletedAt
          ? current.filter((plant) => plant.clientId !== result.plant.clientId)
          : [
              ...current.filter(
                (plant) => plant.clientId !== result.plant.clientId,
              ),
              result.plant,
            ],
      );
    return result;
  }
  async function perform(id: string, work: () => Promise<unknown>) {
    setBusy(id);
    setMessage("");
    try {
      await work();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : say("Something went wrong.", "Не удалось выполнить действие."),
      );
    } finally {
      setBusy(null);
    }
  }
  const careById = new Map(
    plants.map((plant) => [
      plant.clientId,
      plantWateringState(
        { ...plant, lastWateredAt: new Date(plant.lastWateredAt) },
        displayZone,
        new Date(clock),
      ),
    ]),
  );
  const state = (plant: Plant) => careById.get(plant.clientId)!;
  const dueDate = (plant: Plant) =>
    new Date(`${state(plant).dueDate}T12:00:00Z`).toLocaleDateString(
      ru ? "ru-RU" : "en-US",
      { timeZone: "UTC", day: "numeric", month: "short" },
    );
  const filtered = plants.filter(
    (plant) =>
      (!onlyDue || state(plant).daysUntil <= 0) &&
      `${plant.name} ${plant.species} ${plant.location}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
          <PlantIcon className="h-7 w-7 text-accent" />
          {say("Plants", "Растения")}
          <span className="text-base font-normal text-muted">
            {plants.length}
          </span>
        </h1>
        <div className="flex gap-2">
          <button
            className={button}
            onClick={() => setSettingsOpen(!settingsOpen)}
            aria-expanded={settingsOpen}
          >
            <span className="flex items-center gap-2">
              <GearIcon className="h-4 w-4" />
              {say("Reminders", "Напоминания")}
            </span>
          </button>
          <button
            className="rounded-control bg-accent px-4 py-2 text-sm font-semibold text-accent-fg"
            onClick={() => setEditing("new")}
          >
            {say("Add plant", "Добавить растение")}
          </button>
        </div>
      </header>
      {message && (
        <p
          role="status"
          className="rounded-control border border-warn/30 bg-warn/10 p-3 text-sm"
        >
          {message}
        </p>
      )}
      {settingsOpen && (
        <form
          className="space-y-4 rounded-card border border-line bg-surface p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void perform("settings", async () => {
              const result = await request("/api/link/plants/settings", {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(settings),
              });
              setSettings(result.settings);
              setMessage(
                say(
                  "Reminder settings saved for all your devices.",
                  "Настройки напоминаний сохранены для всех ваших устройств.",
                ),
              );
            });
          }}
        >
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {(["enabled", "app", "telegram"] as const).map((key) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings[key]}
                  onChange={(event) =>
                    setSettings({ ...settings, [key]: event.target.checked })
                  }
                />
                {key === "enabled"
                  ? say("Watering reminders", "Напоминать о поливе")
                  : key === "app"
                    ? say("HomePlace and devices", "HomePlace и устройства")
                    : "Telegram"}
              </label>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="space-y-2 text-sm">
              <span>{say("Reminder time", "Время напоминания")}</span>
              <input
                aria-label={say("Reminder time", "Время напоминания")}
                type="time"
                required
                className={field}
                value={settings.time}
                onChange={(event) =>
                  setSettings({ ...settings, time: event.target.value })
                }
              />
            </label>
            <label className="space-y-2 text-sm">
              <span>{say("Time zone", "Часовой пояс")}</span>
              <input
                required
                className={field}
                value={settings.timeZone}
                list="plant-timezones"
                onChange={(event) =>
                  setSettings({ ...settings, timeZone: event.target.value })
                }
              />
              <datalist id="plant-timezones">
                {[
                  "UTC",
                  "Europe/Moscow",
                  "Europe/Berlin",
                  "Asia/Yekaterinburg",
                  "Asia/Novosibirsk",
                  "America/New_York",
                  "America/Los_Angeles",
                ].map((zone) => (
                  <option key={zone}>{zone}</option>
                ))}
              </datalist>
              <button
                type="button"
                className="text-accent"
                onClick={() =>
                  setSettings({
                    ...settings,
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  })
                }
              >
                {say(
                  "Use this device's time zone",
                  "Часовой пояс этого устройства",
                )}
              </button>
            </label>
            <label className="space-y-2 text-sm">
              <span>{say("Repeat until watered", "Повтор до полива")}</span>
              <select
                className={field}
                value={settings.repeatDays}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    repeatDays: Number(event.target.value),
                  })
                }
              >
                <option value="0">{say("Once", "Один раз")}</option>
                {Array.from({ length: 30 }, (_, index) => index + 1).map(
                  (days) => (
                    <option key={days} value={days}>
                      {say(`Every ${days} day(s)`, `Каждые ${days} дн.`)}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
          {settings.telegram && (
            <p className="text-sm text-muted">
              {telegramReady
                ? say(
                    "Sent to the Telegram chat configured in server integrations. Other members of that chat can see these reminders.",
                    "Отправляется в Telegram-чат из настроек интеграций сервера. Участники этого чата видят напоминания.",
                  )
                : say(
                    "Configure Telegram in Settings → Integrations to receive reminders there.",
                    "Настройте Telegram в «Настройки → Интеграции», чтобы получать напоминания.",
                  )}
            </p>
          )}
          {pending > 0 && (
            <p className="text-sm text-muted">
              {say(
                `${pending} reminder(s) waiting for delivery. The server retries automatically.`,
                `Ожидают доставки: ${pending}. Сервер повторяет попытки автоматически.`,
              )}
            </p>
          )}
          <button className={button} disabled={busy !== null}>
            {say("Save settings", "Сохранить настройки")}
          </button>
        </form>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <input
          aria-label={say("Search plants", "Поиск растений")}
          type="search"
          className={`${field} max-w-md`}
          placeholder={say(
            "Name, species or room",
            "Название, вид или комната",
          )}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          className={button}
          aria-pressed={onlyDue}
          onClick={() => setOnlyDue(!onlyDue)}
        >
          {onlyDue
            ? say("Show all", "Показать все")
            : say("Need watering", "Пора полить")}
        </button>
      </div>
      {filtered.length === 0 && (
        <div className="py-14 text-center text-muted">
          <PlantIcon className="mx-auto mb-3 h-10 w-10" />
          <p>
            {plants.length
              ? say("No matching plants.", "Ничего не найдено.")
              : say(
                  "Add your first plant here or sync it from a paired device.",
                  "Добавьте растение здесь или синхронизируйте его с подключённого устройства.",
                )}
          </p>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((plant) => (
          <article
            key={plant.clientId}
            id={`plant-${plant.clientId}`}
            className={`overflow-hidden rounded-card border bg-surface ${focusId === plant.clientId ? "border-accent ring-2 ring-accent/20" : "border-line"}`}
          >
            {/* Authenticated images are fetched directly by the signed-in browser. */}
            {plant.photo ? (
              <img
                src={`${plant.photo.url}?v=${encodeURIComponent(plant.photo.version)}`}
                alt={plant.name}
                loading="lazy"
                className="h-48 w-full object-cover"
              />
            ) : (
              <div className="flex h-32 items-center justify-center bg-raised text-accent/50">
                <PlantIcon className="h-12 w-12" />
              </div>
            )}
            <div className="space-y-3 p-4">
              <div>
                <h2 className="text-lg font-semibold">{plant.name}</h2>
                <p className="text-sm text-muted">
                  {[plant.species, plant.location]
                    .filter(Boolean)
                    .join(" · ") || say("Your plant", "Ваше растение")}
                </p>
              </div>
              <p className="text-sm text-muted">
                {say("Last watered: ", "Последний полив: ")}
                {new Date(plant.lastWateredAt).toLocaleDateString(
                  ru ? "ru-RU" : "en-US",
                  { timeZone: displayZone },
                )}
                <br />
                {say(
                  `Every ${plant.intervalDays} day(s)`,
                  `Каждые ${plant.intervalDays} дн.`,
                )}
              </p>
              <p
                className={`text-sm font-medium ${state(plant).daysUntil <= 0 ? "text-warn" : "text-muted"}`}
              >
                {state(plant).daysUntil < 0
                  ? say(
                      `Overdue by ${-state(plant).daysUntil} day(s)`,
                      `Полив просрочен на ${-state(plant).daysUntil} дн.`,
                    )
                  : state(plant).daysUntil === 0
                    ? say("Water today", "Полить сегодня")
                    : say(
                        `Next watering: ${dueDate(plant)}`,
                        `Следующий полив: ${dueDate(plant)}`,
                      )}
              </p>
              {plant.notes && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted">
                    {say("Notes", "Заметки")}
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap break-words">
                    {plant.notes}
                  </p>
                </details>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={busy !== null}
                  className="rounded-control bg-accent px-3 py-2 text-sm font-semibold text-accent-fg"
                  onClick={() =>
                    void perform(plant.clientId, () =>
                      mutate({
                        action: "water",
                        clientId: plant.clientId,
                        revision: plant.revision,
                        lastWateredAt: new Date().toISOString(),
                      }),
                    )
                  }
                >
                  {say("Watered", "Полито")}
                </button>
                <button className={button} onClick={() => setEditing(plant)}>
                  {say("Edit", "Изменить")}
                </button>
              </div>
              <label className="flex items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  disabled={busy !== null}
                  checked={plant.remindersEnabled}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    void perform(plant.clientId, () =>
                      mutate({
                        ...plant,
                        action: "update",
                        remindersEnabled: enabled,
                      }),
                    );
                  }}
                />
                {say("Remind me to water", "Напоминать о поливе")}
              </label>
              <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3 text-sm">
                <label className="cursor-pointer text-accent">
                  {plant.photo
                    ? say("Replace photo", "Заменить фото")
                    : say("Add photo", "Добавить фото")}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={busy !== null}
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      if (file.size > MAX_PLANT_PHOTO_BYTES) {
                        setMessage(
                          say(
                            "Photo must be no larger than 12 MB.",
                            "Фото должно быть не больше 12 МБ.",
                          ),
                        );
                        return;
                      }
                      void perform(plant.clientId, async () => {
                        const result = await request(
                          `/api/link/plants/${plant.clientId}/photo`,
                          {
                            method: "POST",
                            headers: {
                              "content-type": file.type,
                              "if-match": String(plant.revision),
                            },
                            body: file,
                          },
                        );
                        setPlants((current) =>
                          current.map((item) =>
                            item.clientId === plant.clientId
                              ? result.plant
                              : item,
                          ),
                        );
                      });
                    }}
                  />
                </label>
                {plant.photo && (
                  <button
                    disabled={busy !== null}
                    className="text-muted hover:text-danger"
                    onClick={() =>
                      void perform(plant.clientId, async () => {
                        const result = await request(
                          `/api/link/plants/${plant.clientId}/photo`,
                          {
                            method: "DELETE",
                            headers: { "if-match": String(plant.revision) },
                          },
                        );
                        setPlants((current) =>
                          current.map((item) =>
                            item.clientId === plant.clientId
                              ? result.plant
                              : item,
                          ),
                        );
                      })
                    }
                  >
                    {say("Remove photo", "Удалить фото")}
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {editing !== null && (
        <dialog
          ref={dialog}
          aria-labelledby="plant-editor-title"
          onCancel={() => setEditing(null)}
          className="w-[calc(100%-2rem)] max-w-lg overflow-hidden rounded-card border border-line bg-surface p-0 text-text backdrop:bg-black/45"
        >
          <form
            className="max-h-[90vh] space-y-4 overflow-y-auto p-6"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void perform("editor", async () => {
                await mutate({
                  action: editing === "new" ? "create" : "update",
                  clientId:
                    editing === "new" ? crypto.randomUUID() : editing.clientId,
                  ...(editing !== "new" ? { revision: editing.revision } : {}),
                  name: data.get("name"),
                  species: data.get("species"),
                  location: data.get("location"),
                  notes: data.get("notes"),
                  intervalDays: Number(data.get("intervalDays")),
                  lastWateredAt:
                    editing === "new"
                      ? new Date().toISOString()
                      : editing.lastWateredAt,
                  remindersEnabled:
                    editing === "new" ? true : editing.remindersEnabled,
                });
                setEditing(null);
              });
            }}
          >
            <h2 id="plant-editor-title" className="text-xl font-semibold">
              {editing === "new"
                ? say("New plant", "Новое растение")
                : editing.name}
            </h2>
            {message && (
              <p role="alert" className="text-sm text-danger">
                {message}
              </p>
            )}
            {(
              [
                ["name", say("Name", "Название"), 80],
                ["species", say("Species", "Вид"), 120],
                ["location", say("Room or location", "Комната или место"), 120],
              ] as const
            ).map(([key, label, limit]) => (
              <label key={key} className="block space-y-1 text-sm">
                <span>{label}</span>
                <input
                  autoFocus={key === "name"}
                  name={key}
                  required={key === "name"}
                  maxLength={limit}
                  defaultValue={editing === "new" ? "" : editing[key]}
                  className={field}
                />
              </label>
            ))}
            <label className="block space-y-1 text-sm">
              <span>{say("Water every N days", "Полив каждые N дней")}</span>
              <input
                required
                name="intervalDays"
                type="number"
                min="1"
                max="365"
                defaultValue={editing === "new" ? 7 : editing.intervalDays}
                className={field}
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span>{say("Notes", "Заметки")}</span>
              <textarea
                name="notes"
                maxLength={2000}
                defaultValue={editing === "new" ? "" : editing.notes}
                className={field}
                rows={3}
              />
            </label>
            <div className="flex flex-wrap justify-between gap-2">
              {editing !== "new" && (
                <button
                  type="button"
                  className="text-sm text-danger"
                  disabled={busy !== null}
                  onClick={() => {
                    if (
                      confirm(
                        say(
                          `Delete ${editing.name}?`,
                          `Удалить «${editing.name}»?`,
                        ),
                      )
                    )
                      void perform("editor", async () => {
                        await mutate({
                          action: "delete",
                          clientId: editing.clientId,
                          revision: editing.revision,
                        });
                        setEditing(null);
                      });
                  }}
                >
                  {say("Delete plant", "Удалить растение")}
                </button>
              )}
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  className={button}
                  onClick={() => setEditing(null)}
                >
                  {say("Cancel", "Отмена")}
                </button>
                <button disabled={busy !== null} className={button}>
                  {say("Save", "Сохранить")}
                </button>
              </div>
            </div>
          </form>
        </dialog>
      )}
    </div>
  );
}
