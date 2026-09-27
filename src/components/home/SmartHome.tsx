"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Card, Badge } from "@/components/ui";
import { Input, Select, Button, Field } from "@/components/form";
import { Dialog } from "@/components/Dialog";
import { toggleEntity, setGroupState, saveHomeConfig, entityHistory } from "@/actions/services";
import type { HaHistoryPoint } from "@/lib/services";
import { prettyName, formatValue, VALUE_FORMATS, type ValueFormat } from "@/lib/haFormat";
import { LightControls } from "@/components/widgets/LightControls";
import {
  groupEntities,
  type HomeConfig,
  type HomeGroup,
  type HomeBucket,
} from "@/lib/homeConfig";
import type { Dictionary } from "@/i18n";

export type Entity = {
  id: string;
  name: string;
  state: string;
  unit?: string;
  domain: string;
  toggleable: boolean;
  area?: string;
  device?: string;
  deviceClass?: string;
  brightness?: number;
  rgb?: string;
  supportsColor?: boolean;
  supportsColorTemp?: boolean;
  attributes?: Record<string, string>;
};

/**
 * The whole house on one page.
 *
 * Home Assistant knows the entities, their rooms and their kinds. This adds the
 * operator's own layer on top, all of it saved and universal — nothing here is
 * specific to one house:
 *
 *  - **Groups** made by hand, cutting across rooms, shown ahead of the
 *    automatic room/kind split.
 *  - **Readable names**: an entity that never got a friendly name shows
 *    "Archer AX53 Uptime", not `sensor.archer_ax53_uptime`.
 *  - **Value formats**: that sensor's `2873.133…` minutes becomes "1d 23h",
 *    automatically where Home Assistant says it is a duration, and by choice
 *    everywhere else.
 *
 * Filtering happens in the browser: the state of a house is a few hundred rows,
 * and a round trip per keystroke would be slower than the house itself.
 */
export function SmartHome({
  d,
  entities,
  areas,
  canControl,
  config: initialConfig,
}: {
  d: Dictionary;
  entities: Entity[];
  areas: string[];
  canControl: boolean;
  config: HomeConfig;
}) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<"area" | "domain" | "device">(areas.length > 0 ? "area" : "domain");
  const [only, setOnly] = useState<"all" | "controls" | "sensors" | "on">("all");
  // Which device cards are expanded. In device view a card starts collapsed —
  // the point is to see one device at a time, not every sensor at once.
  const [openDevices, setOpenDevices] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [config, setConfig] = useState<HomeConfig>(initialConfig);
  const [editingEntity, setEditingEntity] = useState<Entity | null>(null);
  const [deviceOpen, setDeviceOpen] = useState<Entity | null>(null);
  const [deviceGroupOpen, setDeviceGroupOpen] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<HomeBucket<Entity> | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);

  function persist(next: HomeConfig) {
    setConfig(next);
    startTransition(() => void saveHomeConfig(next));
  }

  // The name and value as they should read, resolved once and reused.
  const nameOf = (e: Entity) => config.names[e.id] || prettyName(e.id, e.name);
  const valueOf = (e: Entity) => formatValue(e.state, e.unit, config.formats[e.id] ?? "auto", e.deviceClass);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entities.filter((e) => {
      if (only === "controls" && !e.toggleable) return false;
      if (only === "sensors" && e.toggleable) return false;
      if (only === "on" && !isOn(e)) return false;
      if (!needle) return true;
      return `${nameOf(e)} ${e.id} ${e.area ?? ""} ${e.device ?? ""}`.toLowerCase().includes(needle);
    });
    // nameOf depends on config.names; recompute when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities, query, only, config.names]);

  const buckets = useMemo(
    () =>
      groupEntities(shown, config, group, {
        unplaced: group === "area" ? d.home.noArea : group === "device" ? d.home.noDevice : d.home.unplaced,
        kindLabel: (dm) => dm,
      }),
    [shown, config, group, d.home.noArea, d.home.noDevice, d.home.unplaced]
  );

  // In device view, a card is collapsed unless opened; searching opens all so
  // matches are never hidden behind a closed card.
  const searchingDevices = group === "device" && query.trim().length > 0;
  const isDeviceOpen = (key: string) => searchingDevices || openDevices.has(key);
  const toggleDevice = (key: string) =>
    setOpenDevices((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const active = entities.filter(isOn).length;

  function flip(entity: Entity) {
    if (!canControl || !entity.toggleable) return;
    setBusy(entity.id);
    startTransition(async () => {
      await toggleEntity(entity.id);
      setBusy(null);
    });
  }

  /** Turn every switchable device in a bucket on or off at once. */
  function flipBucket(bucket: HomeBucket<Entity>, on: boolean) {
    const ids = bucket.items.filter((e) => e.toggleable).map((e) => e.id);
    if (ids.length === 0) return;
    setBusy(bucket.key);
    startTransition(async () => {
      await setGroupState(ids, on, bucket.name);
      setBusy(null);
    });
  }

  /** Turn a device's switchable entities on or off together. */
  function flipDevice(device: string, on: boolean) {
    const ids = entities.filter((e) => e.device === device && e.toggleable).map((e) => e.id);
    if (ids.length === 0) return;
    setBusy("device:" + device);
    startTransition(async () => {
      await setGroupState(ids, on, device);
      setBusy(null);
    });
  }

  // In room view, an entity that belongs to a physical device folds into a
  // single "device" unit (when the device has more than one entity in the room),
  // so a washing machine is one tile you open, not a scatter of sensors. Loose
  // entities and single-entity devices stay as their own tiles.
  type Unit = { kind: "device"; device: string; items: Entity[] } | { kind: "entity"; entity: Entity };
  function unitsFor(items: Entity[]): Unit[] {
    if (group !== "area") return items.map((entity) => ({ kind: "entity", entity }));
    const byDevice = new Map<string, Entity[]>();
    for (const e of items) if (e.device) byDevice.set(e.device, [...(byDevice.get(e.device) ?? []), e]);
    const seen = new Set<string>();
    const units: Unit[] = [];
    for (const e of items) {
      if (e.device && (byDevice.get(e.device)?.length ?? 0) >= 2) {
        if (seen.has(e.device)) continue;
        seen.add(e.device);
        units.push({ kind: "device", device: e.device, items: byDevice.get(e.device)! });
      } else {
        units.push({ kind: "entity", entity: e });
      }
    }
    return units;
  }

  function renderEntityCard(entity: Entity) {
    const on = isOn(entity);
    const canToggle = canControl && entity.toggleable;
    return (
      <Card
        key={entity.id}
        className={`group relative flex cursor-pointer flex-col gap-1 p-3 transition-colors hover:border-accent ${
          on && entity.toggleable ? "border-accent/40 bg-accent/5" : ""
        } ${busy === entity.id && pending ? "opacity-60" : ""}`}
      >
        {canControl && (
          <button
            type="button"
            onClick={() => setEditingEntity(entity)}
            title={d.home.customize}
            className="absolute right-1 top-1 z-10 rounded-control px-1 text-xs text-faint opacity-0 transition-opacity hover:bg-raised hover:text-text group-hover:opacity-100"
          >
            ⋯
          </button>
        )}
        <div className="flex w-full items-start gap-2">
          <button type="button" onClick={() => setDeviceOpen(entity)} className="flex min-w-0 flex-1 items-start gap-2 text-left">
            <span className="text-lg leading-none" aria-hidden>
              {domainIcon(entity.domain)}
            </span>
            <span className="block min-w-0 flex-1 truncate text-xs font-medium">{nameOf(entity)}</span>
          </button>
          {entity.toggleable && (
            <button type="button" onClick={() => flip(entity)} disabled={!canToggle} aria-label={on ? d.home.allOff : d.home.allOn} className="shrink-0 disabled:cursor-default">
              <span className={`block h-4 w-7 rounded-full transition-colors ${on ? "bg-accent" : "bg-line"}`} aria-hidden>
                <span className={`mt-[2px] block h-3 w-3 rounded-full bg-surface transition-transform ${on ? "translate-x-[14px]" : "translate-x-[2px]"}`} />
              </span>
            </button>
          )}
        </div>
        <button type="button" onClick={() => setDeviceOpen(entity)} className="flex flex-wrap items-center gap-1 text-left">
          <Badge tone={on && entity.toggleable ? "accent" : "neutral"}>{valueOf(entity)}</Badge>
          {Object.entries(entity.attributes ?? {}).map(([key, value]) => (
            <span key={key} className="text-[10px] text-faint">
              {shortAttribute(key)} {value}
            </span>
          ))}
        </button>
      </Card>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">{d.home.title}</h1>
        <span className="text-xs text-muted">
          {entities.length} · {active} {d.home.on}
        </span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={d.common.search} aria-label={d.common.search} className="!w-full sm:!w-52" />
        <Select value={group} onChange={(e) => setGroup(e.target.value as typeof group)} aria-label={d.home.byRoom} className="!w-full sm:!w-40">
          <option value="area">{d.home.byRoom}</option>
          <option value="device">{d.home.byDevice}</option>
          <option value="domain">{d.home.byKind}</option>
        </Select>
        <Select value={only} onChange={(e) => setOnly(e.target.value as typeof only)} aria-label={d.home.everything} className="!w-full sm:!w-40">
          <option value="all">{d.home.everything}</option>
          <option value="controls">{d.home.controls}</option>
          <option value="sensors">{d.home.sensors}</option>
          <option value="on">{d.home.onlyOn}</option>
        </Select>
        {canControl && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setCreatingGroup(true)}>
            ＋ {d.home.newGroup}
          </Button>
        )}
      </div>

      <div className="space-y-5">
        {buckets.length === 0 && <p className="text-sm text-muted">{d.widgets.noData}</p>}

        {buckets.map((bucket) => {
          // An empty hand-made group stays visible so it can be filled; empty
          // automatic buckets cannot occur.
          if (bucket.items.length === 0 && bucket.groupId === undefined) return null;

          const switchable = bucket.items.filter((e) => e.toggleable);
          const anyOn = switchable.some(isOn);

          return (
            <section key={bucket.key}>
              <div className="mb-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => group === "device" && toggleDevice(bucket.key)}
                  className={`flex min-w-0 items-center gap-1.5 text-left text-sm font-semibold tracking-tight ${
                    group === "device" ? "transition-colors hover:text-accent" : "cursor-default"
                  }`}
                  aria-expanded={group === "device" ? isDeviceOpen(bucket.key) : undefined}
                >
                  {group === "device" && (
                    <span className="text-faint" aria-hidden>
                      {isDeviceOpen(bucket.key) ? "▾" : "▸"}
                    </span>
                  )}
                  {bucket.icon && <span aria-hidden>{bucket.icon}</span>}
                  <span className="truncate">{bucket.name}</span>
                  <span className="text-muted">· {bucket.items.length}</span>
                  {switchable.length > 0 && anyOn && <span className="text-[11px] font-medium text-accent">· {switchable.filter(isOn).length} on</span>}
                </button>

                {/* Control the whole group at once — the switchable ones in it.
                    Individual devices stay independently switchable below. */}
                {canControl && switchable.length > 0 && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => flipBucket(bucket, true)}
                      disabled={pending && busy === bucket.key}
                      className={`rounded-control border px-2 py-0.5 text-[11px] transition-colors ${
                        anyOn ? "border-accent/40 text-accent" : "border-line text-muted hover:bg-raised hover:text-text"
                      }`}
                    >
                      {d.home.allOn}
                    </button>
                    <button
                      type="button"
                      onClick={() => flipBucket(bucket, false)}
                      disabled={pending && busy === bucket.key}
                      className="rounded-control border border-line px-2 py-0.5 text-[11px] text-muted transition-colors hover:bg-raised hover:text-text"
                    >
                      {d.home.allOff}
                    </button>
                  </div>
                )}

                {canControl && bucket.groupId && (
                  <button
                    type="button"
                    onClick={() => setEditingGroup(bucket)}
                    className="rounded-control px-1.5 text-xs text-faint transition-colors hover:bg-raised hover:text-text"
                    title={d.home.editGroup}
                  >
                    ✎
                  </button>
                )}
              </div>

              {bucket.items.length === 0 ? (
                <p className="text-xs text-muted">{d.home.groupMembersHint}</p>
              ) : group === "device" && !isDeviceOpen(bucket.key) ? null : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {unitsFor(bucket.items).map((unit) =>
                    unit.kind === "entity" ? (
                      renderEntityCard(unit.entity)
                    ) : (
                      <DeviceTile
                        key={"dev:" + unit.device}
                        device={unit.device}
                        items={unit.items}
                        isOn={isOn}
                        busy={busy === "device:" + unit.device && pending}
                        canControl={canControl}
                        onOpen={() => setDeviceGroupOpen(unit.device)}
                        onFlip={(on) => flipDevice(unit.device, on)}
                        allOn={d.home.allOn}
                        allOff={d.home.allOff}
                      />
                    )
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* Per-device: a readable name and how the value is shown. */}
      {editingEntity && (
        <EntityDialog
          d={d}
          entity={editingEntity}
          config={config}
          onClose={() => setEditingEntity(null)}
          onSave={(next) => {
            persist(next);
            setEditingEntity(null);
          }}
        />
      )}

      {/* The device panel: control it here, and read its recent history. */}
      {deviceOpen && (
        <DeviceDialog
          d={d}
          entity={deviceOpen}
          name={nameOf(deviceOpen)}
          value={valueOf(deviceOpen)}
          formatState={(s) =>
            formatValue(s, deviceOpen.unit, config.formats[deviceOpen.id] ?? "auto", deviceOpen.deviceClass)
          }
          canControl={canControl}
          onToggle={() => flip(deviceOpen)}
          onCustomize={() => {
            setEditingEntity(deviceOpen);
            setDeviceOpen(null);
          }}
          onClose={() => setDeviceOpen(null)}
        />
      )}

      {/* The whole device: every entity it has, switchable and readable here.
          Tapping one opens its own panel for the history. */}
      {deviceGroupOpen && (
        <Dialog open onClose={() => setDeviceGroupOpen(null)} title={deviceGroupOpen} wide>
          <div className="divide-y divide-line">
            {entities
              .filter((e) => e.device === deviceGroupOpen)
              .map((e) => {
                const on = isOn(e);
                return (
                  <div key={e.id} className="flex items-center gap-3 py-2.5">
                    <span className="text-lg leading-none" aria-hidden>
                      {domainIcon(e.domain)}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setDeviceGroupOpen(null);
                        setDeviceOpen(e);
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      {/* The device name is already the dialog title, so drop it
                          from each row — "Water temperature", not "Washer Water
                          temperature". */}
                      <p className="truncate text-sm font-medium">
                        {(() => {
                          const full = nameOf(e);
                          return full.length > deviceGroupOpen.length + 1 && full.startsWith(deviceGroupOpen + " ")
                            ? full.slice(deviceGroupOpen.length + 1)
                            : full;
                        })()}
                      </p>
                      <p className="truncate text-xs text-muted">{valueOf(e)}</p>
                    </button>
                    {e.toggleable && (
                      <button
                        type="button"
                        onClick={() => flip(e)}
                        disabled={!canControl}
                        aria-label={on ? d.home.allOff : d.home.allOn}
                        className="shrink-0 disabled:cursor-default"
                      >
                        <span className={`block h-5 w-9 rounded-full transition-colors ${on ? "bg-accent" : "bg-line"}`} aria-hidden>
                          <span className={`mt-[3px] block h-3.5 w-3.5 rounded-full bg-surface transition-transform ${on ? "translate-x-[18px]" : "translate-x-[3px]"}`} />
                        </span>
                      </button>
                    )}
                  </div>
                );
              })}
          </div>
        </Dialog>
      )}

      {/* Create / edit a hand-made group. */}
      {creatingGroup && (
        <HomeGroupDialog
          d={d}
          entities={entities}
          config={config}
          bucket={null}
          nameOf={nameOf}
          onClose={() => setCreatingGroup(false)}
          onSave={(next) => {
            persist(next);
            setCreatingGroup(false);
          }}
        />
      )}
      {editingGroup && (
        <HomeGroupDialog
          d={d}
          entities={entities}
          config={config}
          bucket={editingGroup}
          nameOf={nameOf}
          onClose={() => setEditingGroup(null)}
          onSave={(next) => {
            persist(next);
            setEditingGroup(null);
          }}
        />
      )}
    </>
  );
}

/** A dialog to rename one entity and choose how its value is shown. */
function EntityDialog({
  d,
  entity,
  config,
  onClose,
  onSave,
}: {
  d: Dictionary;
  entity: Entity;
  config: HomeConfig;
  onClose: () => void;
  onSave: (next: HomeConfig) => void;
}) {
  const [name, setName] = useState(config.names[entity.id] ?? "");
  const [format, setFormat] = useState<ValueFormat>(config.formats[entity.id] ?? "auto");

  const formatLabel: Record<ValueFormat, string> = {
    auto: d.home.fmtAuto,
    number: d.home.fmtNumber,
    duration: d.home.fmtDuration,
    bytes: d.home.fmtBytes,
    percent: d.home.fmtPercent,
    datetime: d.home.fmtDatetime,
    relative: d.home.fmtRelative,
    raw: d.home.fmtRaw,
  };

  function save() {
    const names = { ...config.names };
    if (name.trim()) names[entity.id] = name.trim();
    else delete names[entity.id];

    const formats = { ...config.formats };
    if (format !== "auto") formats[entity.id] = format;
    else delete formats[entity.id];

    onSave({ ...config, names, formats });
  }

  return (
    <Dialog open onClose={onClose} title={prettyName(entity.id, entity.name)} wide>
      <div className="space-y-4">
        <Field label={d.home.displayName} hint={d.home.displayNameHint}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={prettyName(entity.id, entity.name)} />
        </Field>

        <Field label={d.home.valueFormat}>
          <Select value={format} onChange={(e) => setFormat(e.target.value as ValueFormat)}>
            {VALUE_FORMATS.map((f) => (
              <option key={f} value={f}>
                {formatLabel[f]}
              </option>
            ))}
          </Select>
        </Field>

        {/* Live preview, so the choice is confirmed before it is saved. */}
        <div className="flex items-center justify-between rounded-control border border-line bg-raised px-3 py-2 text-sm">
          <span className="font-mono text-[11px] text-faint">
            {entity.state}
            {entity.unit ? ` ${entity.unit}` : ""}
          </span>
          <span className="font-mono tabular-nums">→ {formatValue(entity.state, entity.unit, format, entity.deviceClass)}</span>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="quiet" onClick={onClose}>
            {d.common.cancel}
          </Button>
          <Button variant="primary" onClick={save}>
            {d.common.save}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Create or edit a hand-made group of devices. */
function HomeGroupDialog({
  d,
  entities,
  config,
  bucket,
  nameOf,
  onClose,
  onSave,
}: {
  d: Dictionary;
  entities: Entity[];
  config: HomeConfig;
  bucket: HomeBucket<Entity> | null;
  nameOf: (e: Entity) => string;
  onClose: () => void;
  onSave: (next: HomeConfig) => void;
}) {
  const existing = bucket?.groupId ? config.groups.find((g) => g.id === bucket.groupId) : undefined;
  const [name, setName] = useState(bucket?.name ?? "");
  const [icon, setIcon] = useState(bucket?.icon ?? "");
  const [members, setMembers] = useState<string[]>(existing?.members ?? []);

  const takenElsewhere = useMemo(() => {
    const set = new Set<string>();
    for (const g of config.groups) {
      if (g.id === existing?.id) continue;
      for (const m of g.members) set.add(m);
    }
    return set;
  }, [config.groups, existing?.id]);

  const [pick, setPick] = useState("");

  // The picker is grouped the way the house is thought about — lights with
  // lights, sensors with sensors — and searchable, so a group is assembled by
  // category instead of hunted for down one long alphabetical list.
  const categories = useMemo(() => {
    const needle = pick.trim().toLowerCase();
    const shown = entities.filter((e) => !needle || `${nameOf(e)} ${e.id} ${e.area ?? ""}`.toLowerCase().includes(needle));
    const map = new Map<string, Entity[]>();
    for (const e of shown) {
      const list = map.get(e.domain);
      if (list) list.push(e);
      else map.set(e.domain, [e]);
    }
    return [...map.entries()]
      .map(([domain, list]) => ({ domain, list: list.sort((a, b) => nameOf(a).localeCompare(nameOf(b))) }))
      .sort((a, b) => b.list.length - a.list.length || a.domain.localeCompare(b.domain));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities, pick, config.names]);

  function toggleMember(id: string) {
    setMembers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  /** Add or remove a whole category at once — every one not already spoken for. */
  function toggleCategory(list: Entity[]) {
    const free = list.filter((e) => !takenElsewhere.has(e.id)).map((e) => e.id);
    const allIn = free.every((id) => members.includes(id));
    setMembers((prev) => (allIn ? prev.filter((id) => !free.includes(id)) : [...new Set([...prev, ...free])]));
  }

  function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (existing) {
      const groups = config.groups.map((g) =>
        g.id === existing.id ? { ...g, name: trimmed, icon: icon.trim() || undefined, members } : g
      );
      onSave({ ...config, groups });
    } else {
      const grp: HomeGroup = { id: `h${Date.now().toString(36)}`, name: trimmed, icon: icon.trim() || undefined, members };
      onSave({ ...config, groups: [...config.groups, grp] });
    }
  }

  function remove() {
    if (existing) onSave({ ...config, groups: config.groups.filter((g) => g.id !== existing.id) });
  }

  return (
    <Dialog open onClose={onClose} title={bucket ? d.home.editGroup : d.home.newGroup} wide>
      <div className="space-y-4">
        <Field label={d.home.groupName}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={d.home.groupIcon}>
          <Input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="🛋️" />
        </Field>
        <Field label={d.home.groupMembers} hint={d.home.groupMembersHint}>
          <Input
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            placeholder={d.common.search}
            className="mb-2 w-full"
          />
          <div className="max-h-64 space-y-3 overflow-y-auto rounded-control border border-line p-2">
            {categories.length === 0 && <p className="px-1 py-2 text-xs text-muted">{d.widgets.noData}</p>}
            {categories.map(({ domain, list }) => {
              const free = list.filter((e) => !takenElsewhere.has(e.id));
              const allIn = free.length > 0 && free.every((e) => members.includes(e.id));
              return (
                <div key={domain}>
                  <div className="mb-1 flex items-center gap-1.5 px-1">
                    <span aria-hidden>{domainIcon(domain)}</span>
                    <span className="text-xs font-semibold capitalize">{domain.replace(/_/g, " ")}</span>
                    <span className="text-[11px] text-muted">· {list.length}</span>
                    {free.length > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleCategory(list)}
                        title={allIn ? d.home.allOff : d.home.allOn}
                        className="ml-auto rounded-control border border-line px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-raised hover:text-text"
                      >
                        {allIn ? "−" : "+"}
                      </button>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    {list.map((e) => {
                      const taken = takenElsewhere.has(e.id);
                      return (
                        <label
                          key={e.id}
                          className={`flex items-center gap-2 rounded-control px-2 py-1 text-sm ${
                            taken ? "opacity-40" : "cursor-pointer hover:bg-raised"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={members.includes(e.id)}
                            disabled={taken}
                            onChange={() => toggleMember(e.id)}
                          />
                          <span className="truncate">{nameOf(e)}</span>
                          {e.area && <span className="ml-auto font-mono text-[10px] text-faint">{e.area}</span>}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </Field>

        <div className="flex items-center justify-between gap-2 pt-1">
          {existing ? (
            <Button variant="danger" onClick={remove}>
              {d.home.deleteGroup}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="quiet" onClick={onClose}>
              {d.common.cancel}
            </Button>
            <Button variant="primary" onClick={save}>
              {d.common.save}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * One device, opened.
 *
 * The card is a glance; this is the whole thing — the current value, the switch
 * where it has one, its attributes, and the log Home Assistant keeps of it: the
 * light going on and off, the sensor's readings, the washing machine's run.
 * The log reads time-first, left to right, the way a log is read.
 */
function DeviceDialog({
  d,
  entity,
  name,
  value,
  formatState,
  canControl,
  onToggle,
  onCustomize,
  onClose,
}: {
  d: Dictionary;
  entity: Entity;
  name: string;
  value: string;
  formatState: (state: string) => string;
  canControl: boolean;
  onToggle: () => void;
  onCustomize: () => void;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<HaHistoryPoint[] | null>(null);
  const on = isOn(entity);

  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    void entityHistory(entity.id).then((h) => {
      if (!cancelled) setHistory(h);
    });
    return () => {
      cancelled = true;
    };
  }, [entity.id]);

  return (
    <Dialog open onClose={onClose} title={name} wide>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-control border border-line bg-raised px-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold tabular-nums">{value}</p>
            <p className="truncate font-mono text-[11px] text-faint">{entity.id}</p>
          </div>
          {entity.toggleable && canControl && (
            <Button variant={on ? "primary" : "quiet"} onClick={onToggle}>
              {on ? d.home.allOff : d.home.allOn}
            </Button>
          )}
        </div>

        {/* Full light control — dimmer and colour — when this is a light. */}
        {entity.domain === "light" && on && canControl && (
          <LightControls
            d={d}
            light={{
              id: entity.id,
              brightness: entity.brightness,
              rgb: entity.rgb,
              supportsColor: entity.supportsColor,
              supportsColorTemp: entity.supportsColorTemp,
            }}
          />
        )}

        {entity.attributes && Object.keys(entity.attributes).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(entity.attributes).map(([key, val]) => (
              <Badge key={key}>
                {key.replace(/_/g, " ")}: {val}
              </Badge>
            ))}
          </div>
        )}

        <div>
          <p className="mb-2 text-xs font-medium text-muted">{d.home.history}</p>
          {history === null ? (
            <p className="text-sm text-muted">{d.common.loading}</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted">{d.home.noHistory}</p>
          ) : (
            <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-control border border-line">
              {history.map((h, i) => (
                <li key={i} className="flex items-baseline gap-3 px-3 py-1.5">
                  {/* Time first — a log is read left to right, oldest thing you
                      look for is "when". */}
                  <span className="w-24 shrink-0 font-mono text-[11px] tabular-nums text-faint">{historyTime(h.at)}</span>
                  <span className="truncate text-sm">{formatState(h.state)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between pt-1">
          {canControl ? (
            <Button variant="quiet" onClick={onCustomize}>
              {d.home.customize}
            </Button>
          ) : (
            <span />
          )}
          <Button variant="quiet" onClick={onClose}>
            {d.common.close}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** "DD.MM HH:MM" — compact and unambiguous for a scrollable log. */
function historyTime(at: string): string {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** "on", "open", "home" and "playing" all mean the same thing on a card. */
function isOn(entity: Entity): boolean {
  return ["on", "open", "home", "playing", "heat", "cool", "active"].includes(entity.state);
}

/** A whole device as one room tile: name, a switch for all its toggles, a count. */
function DeviceTile({
  device,
  items,
  isOn,
  busy,
  canControl,
  onOpen,
  onFlip,
  allOn,
  allOff,
}: {
  device: string;
  items: Entity[];
  isOn: (e: Entity) => boolean;
  busy: boolean;
  canControl: boolean;
  onOpen: () => void;
  onFlip: (on: boolean) => void;
  allOn: string;
  allOff: string;
}) {
  const toggles = items.filter((e) => e.toggleable);
  const anyOn = toggles.some(isOn);
  const onCount = items.filter(isOn).length;
  return (
    <Card
      className={`flex cursor-pointer flex-col gap-1 p-3 transition-colors hover:border-accent ${anyOn ? "border-accent/40 bg-accent/5" : ""} ${
        busy ? "opacity-60" : ""
      }`}
    >
      <div className="flex w-full items-start gap-2">
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-2 text-left">
          <span className="text-lg leading-none" aria-hidden>
            🔌
          </span>
          <span className="block min-w-0 flex-1 truncate text-xs font-medium">{device}</span>
        </button>
        {toggles.length > 0 && (
          <button type="button" onClick={() => onFlip(!anyOn)} disabled={!canControl} aria-label={anyOn ? allOff : allOn} className="shrink-0 disabled:cursor-default">
            <span className={`block h-4 w-7 rounded-full transition-colors ${anyOn ? "bg-accent" : "bg-line"}`} aria-hidden>
              <span className={`mt-[2px] block h-3 w-3 rounded-full bg-surface transition-transform ${anyOn ? "translate-x-[14px]" : "translate-x-[2px]"}`} />
            </span>
          </button>
        )}
      </div>
      <button type="button" onClick={onOpen} className="text-left text-[10px] text-faint">
        {items.length} · {onCount} ●
      </button>
    </Card>
  );
}

function domainIcon(domain: string): string {
  const icons: Record<string, string> = {
    light: "💡",
    switch: "🔌",
    sensor: "📊",
    binary_sensor: "⚫",
    climate: "🌡️",
    media_player: "🔊",
    camera: "📷",
    cover: "🪟",
    lock: "🔒",
    fan: "🌀",
    vacuum: "🧹",
    scene: "🎬",
    script: "📜",
    automation: "⚙️",
    person: "🧍",
    device_tracker: "📍",
    weather: "🌤️",
    sun: "☀️",
    update: "⬆️",
    button: "🔘",
    number: "🔢",
    input_boolean: "🔘",
  };
  return icons[domain] ?? "•";
}

function shortAttribute(key: string): string {
  const names: Record<string, string> = {
    brightness: "☼",
    current_temperature: "🌡",
    temperature: "🌡",
    humidity: "💧",
    battery_level: "🔋",
    media_title: "♪",
  };
  return names[key] ?? key;
}
