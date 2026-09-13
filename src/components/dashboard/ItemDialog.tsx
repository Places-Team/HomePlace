"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import type { Item } from "@prisma/client";
import { Dialog } from "@/components/Dialog";
import { Field, Input, Select, Textarea, Button } from "@/components/form";
import { createItem, updateItem, type ItemInput } from "@/actions/dashboard";
import { listHomeGroups } from "@/actions/services";
import { autoIcon, iconPackUrl, guessIcon, GLYPH } from "@/lib/icons";
import { TileIcon } from "@/components/TileIcon";
import { IconPicker } from "@/components/IconPicker";
import { PlacePicker } from "./PlacePicker";
import { WidgetPicker } from "./WidgetPicker";
import { HaEntityPicker } from "./HaEntityPicker";
import { MetricPicker } from "./MetricPicker";
import { ImagePicker } from "@/components/ImagePicker";
import type { Dictionary } from "@/i18n";

export type ContainerOption = {
  name: string;
  hostKey: string;
  hostLabel: string;
  state: string;
  image?: string;
  suggestedUrl?: string;
  icon?: string;
  group?: string;
  /** Already has a tile somewhere — shown last and marked. */
  onDashboard?: boolean;
};

type Kind = "service" | "link" | "folder" | "widget" | "section";

const widgetKinds = [
  "system",
  "disks",
  "load",
  "chart",
  "gauge",
  "uptimestrip",
  "weather",
  "calendar",
  "jellyfin",
  "qbittorrent",
  "arr",
  "pbs",
  "homeassistant",
  "mediaplayer",
  "reminders",
  "containers",
  "proxmox",
  "clock",
  "notes",
  "slideshow",
  "nowplaying",
] as const;

/**
 * The one form that creates and edits everything on a dashboard.
 *
 * Add and edit share it deliberately: they ask for the same fields, and two
 * copies would drift the moment one of them gains an option.
 */
export function ItemDialog({
  d,
  mode,
  item,
  dashboardId,
  initialKind,
  containers = [],
  folders = [],
  iconPack = false,
  onClose,
}: {
  d: Dictionary;
  mode: "add" | "edit";
  item?: Item;
  dashboardId?: string;
  initialKind?: Kind;
  containers?: ContainerOption[];
  folders?: { id: string; title: string }[];
  iconPack?: boolean;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<Kind>((item?.kind as Kind) ?? initialKind ?? "link");
  const [pending, startTransition] = useTransition();

  const config = parseConfig(item?.config);
  const [form, setForm] = useState({
    title: item?.title ?? "",
    subtitle: item?.subtitle ?? "",
    icon: item?.icon ?? "",
    url: item?.url ?? "",
    internalUrl: item?.internalUrl ?? "",
    newTab: item?.newTab ?? true,
    containerName: item?.containerName ?? "",
    hostKey: item?.hostKey ?? "",
    checkKind: item?.checkKind ?? "none",
    checkInterval: item?.checkInterval ?? 60,
    parentId: item?.parentId ?? "",
    w: item?.w ?? 3,
    widget: item?.widget ?? "system",
    // Widget settings, flattened into the same state so one change handler
    // covers the whole form.
    query: str(config.query),
    unit: str(config.unit) || "number",
    rangeMinutes: Number(config.rangeMinutes ?? 180),
    instance: str(config.instance),
    timeZone: str(config.timeZone),
    text: str(config.text),
    linksText: Array.isArray(config.links) ? (config.links as string[]).join("\n") : str(config.links),
    images: Array.isArray(config.images) ? (config.images as string[]).join("\n") : str(config.images),
    intervalSeconds: Number(config.intervalSeconds ?? 20),
    caption: str(config.caption),
    fit: str(config.fit) || "cover",
    containersFilter: Array.isArray(config.containers) ? (config.containers as string[]).join("\n") : str(config.containers),
    sortBy: str(config.sortBy) || "cpu",
    limit: Number(config.limit ?? 6),
    price: config.price === undefined ? "" : String(config.price),
    currency: str(config.currency) || "₽",
    query2: str(config.query2),
    place: str(config.place),
    latitude: config.latitude === undefined ? "" : String(config.latitude),
    longitude: config.longitude === undefined ? "" : String(config.longitude),
    min: Number(config.min ?? 0),
    max: Number(config.max ?? 100),
    warn: Number(config.warn ?? 75),
    danger: Number(config.danger ?? 90),
    hours: Number(config.hours ?? 24),
    blocks: Number(config.blocks ?? 40),
    days: Number(config.days ?? 7),
    entities: Array.isArray(config.entities) ? (config.entities as string[]).join("\n") : str(config.entities),
    background: str(config.background) || "drift",
    detail: str(config.detail) || "none",
    folderDisplay: str(config.display) === "panel" ? "panel" : "folder",
    likePhrase: str(config.likePhrase),
    likeLabel: str(config.likeLabel),
    likeService: str(config.likeService) || "media_player.play_media",
    services: Array.isArray(config.items) ? (config.items as string[]).join("\n") : str(config.items),
    // Jellyfin: which shelf, how many posters, and whether the now-playing
    // strip and the library counts appear.
    jfSource: str(config.source) || "auto",
    jfLimit: Number(config.limit ?? 12),
    jfShowSessions: config.showSessions !== false,
    jfShowCounts: config.showCounts !== false,
    // Home-groups widget: which groups to show (empty = all).
    homeGroups: Array.isArray(config.groups) ? (config.groups as string[]) : [],
    homeGroupBy: str(config.groupBy) === "device" ? "device" : "area",
    habitsList: Array.isArray(config.habits) ? (config.habits as string[]).join("\n") : str(config.habits),
    refreshSeconds: Number(config.refreshSeconds ?? 10),
    // Feed / embed widgets: the address they read.
    feedUrl: str(config.url),
    // World clocks and the countdown.
    zones: Array.isArray(config.zones) ? (config.zones as string[]).join("\n") : str(config.zones),
    countdownTarget: str(config.target),
    countdownLabel: str(config.label),
    // Currency rates widget.
    ratesBase: str(config.base) || "USD",
    ratesSymbols: Array.isArray(config.symbols) ? (config.symbols as string[]).join("\n") : str(config.symbols),
    // Wake-on-LAN machines, one per line as "Name | MAC | broadcast".
    wolMachines: Array.isArray(config.machines)
      ? (config.machines as { name?: string; mac?: string; broadcast?: string }[])
          .map((m) => [m.name, m.mac, m.broadcast].filter(Boolean).join(" | "))
          .join("\n")
      : str(config.machines),
    // Extras for a container tile. Off by default: a tile is a link first, and
    // a dashboard of tiles that all sprout meters is a monitoring screen.
    showStats: config.stats === true,
    showControls: config.controls === true,
    showUptime: config.uptime === true,
    showPorts: config.ports === true,
    showImage: config.image === true,
  });

  // Set while the container of an existing tile is being swapped for another.
  const [rebinding, setRebinding] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /**
   * Picking a container.
   *
   * When adding, that click *is* the whole interaction: the container already
   * knows its name, its port and (through the labels or the image) its icon, so
   * asking for the same facts in a form afterwards would be asking the user to
   * retype what the server just told us. The tile appears; anything about it
   * can still be changed from the pencil.
   *
   * When editing an existing tile, it only refills the fields — that dialog is
   * a form and stays one.
   */
  function pickContainer(name: string) {
    const found = containers.find((c) => c.name === name);
    if (!found) return;

    const filled = {
      containerName: found.name,
      hostKey: found.hostKey,
      title: form.title || found.name,
      // The guessed address carries a placeholder for the host, because the
      // server cannot know which name or IP this browser reached it by.
      url: form.url || (found.suggestedUrl ?? "").replace("HOST_ADDRESS", window.location.hostname),
      icon: form.icon || found.icon || "",
      // Container state is the check that needs no configuration and cannot be
      // fooled by a login page.
      checkKind: form.checkKind === "none" ? "docker" : form.checkKind,
    };

    if (mode === "edit") {
      setForm((f) => ({ ...f, ...filled }));
      return;
    }

    startTransition(async () => {
      await createItem({
        dashboardId: dashboardId!,
        kind: "service",
        title: filled.title,
        icon: filled.icon || null,
        url: filled.url || null,
        containerName: filled.containerName,
        hostKey: filled.hostKey,
        checkKind: "docker",
      });
      onClose();
    });
  }

  function submit() {
    const payload: ItemInput = {
      dashboardId: dashboardId ?? item!.dashboardId,
      parentId: form.parentId || null,
      kind,
      title: form.title,
      subtitle: form.subtitle || null,
      icon: form.icon || null,
      url: form.url || null,
      internalUrl: form.internalUrl || null,
      newTab: form.newTab,
      containerName: form.containerName || null,
      hostKey: form.hostKey || null,
      checkKind: kind === "widget" || kind === "folder" ? "none" : form.checkKind,
      checkInterval: Number(form.checkInterval),
      widget: kind === "widget" ? form.widget : null,
      config:
        kind === "widget"
          ? widgetConfig()
          : kind === "service"
            ? extrasConfig()
            : kind === "folder"
              ? { detail: form.detail, display: form.folderDisplay }
              : undefined,
      w: Number(form.w),
    };

    startTransition(async () => {
      if (mode === "add") await createItem(payload);
      else await updateItem(item!.id, payload);
      onClose();
    });
  }

  /** What a container tile shows besides its name. */
  function extrasConfig(): Record<string, unknown> | null {
    if (!form.containerName) return null;
    const extras = {
      stats: form.showStats,
      controls: form.showControls,
      uptime: form.showUptime,
      ports: form.showPorts,
      image: form.showImage,
    };
    // Nothing switched on is stored as no config at all, so a plain tile stays
    // plain in the database instead of carrying five falses. Null rather than
    // undefined: undefined means "leave what is there", which would make the
    // last extra impossible to switch off.
    return Object.values(extras).some(Boolean) ? extras : null;
  }

  function widgetConfig(): Record<string, unknown> {
    switch (form.widget) {
      case "chart":
        return {
          query: form.query,
          query2: form.query2,
          unit: form.unit,
          rangeMinutes: Number(form.rangeMinutes),
        };
      case "gauge":
        return {
          query: form.query,
          unit: form.unit,
          min: Number(form.min),
          max: Number(form.max),
          warn: Number(form.warn),
          danger: Number(form.danger),
          caption: form.caption,
        };
      case "weather":
      case "airquality":
        return {
          place: form.place,
          latitude: Number(form.latitude),
          longitude: Number(form.longitude),
        };
      case "jellyfin":
        return {
          source: form.jfSource,
          limit: Number(form.jfLimit),
          showSessions: form.jfShowSessions,
          showCounts: form.jfShowCounts,
        };
      case "homeassistant":
        return { entities: form.entities.split("\n").map((e) => e.trim()).filter(Boolean) };
      case "homegroups":
        return { groups: form.homeGroups, groupBy: form.homeGroupBy };
      case "energy":
        return { price: Number(form.price) || 0, currency: form.currency.trim() || "₽", limit: Number(form.limit) };
      case "habits":
        return { habits: form.habitsList.split("\n").map((h) => h.trim()).filter(Boolean) };
      case "cameras":
        return { entities: form.entities.split("\n").map((e) => e.trim()).filter(Boolean), refreshSeconds: Number(form.refreshSeconds) || 10 };
      case "feed":
        return { url: form.feedUrl.trim(), limit: Number(form.limit) };
      case "embed":
        return { url: form.feedUrl.trim() };
      case "ical":
        return { url: form.feedUrl.trim(), limit: Number(form.limit) };
      case "rates":
        return {
          base: form.ratesBase.trim().toUpperCase(),
          symbols: form.ratesSymbols.split("\n").map((s) => s.trim().toUpperCase()).filter(Boolean),
        };
      case "wol":
        return {
          machines: form.wolMachines
            .split("\n")
            .map((line) => {
              const [name, mac, broadcast] = line.split("|").map((s) => s.trim());
              return mac ? { name: name || mac, mac, broadcast: broadcast || undefined } : null;
            })
            .filter(Boolean),
        };
      case "worldclocks":
        return { zones: form.zones.split("\n").map((z) => z.trim()).filter(Boolean) };
      case "countdown":
        return { target: form.countdownTarget, label: form.countdownLabel.trim() };
      case "recentevents":
        return { limit: Number(form.limit) };
      case "sla":
        return {
          items: form.services.split("\n").map((n) => n.trim()).filter(Boolean),
          hours: Number(form.hours),
          limit: Number(form.limit),
        };
      case "mediaplayer":
        return {
          entities: form.entities.split("\n").map((e) => e.trim()).filter(Boolean),
          background: form.background,
          // An empty phrase is what turns the button off, so it is stored as
          // written rather than as a separate flag nobody would think to unset.
          likePhrase: form.likePhrase.trim(),
          likeLabel: form.likeLabel.trim(),
          likeService: form.likeService.trim(),
        };
      case "calendar":
        // Nothing to configure: the widget shows the month, and how much of it
        // fits is decided by dragging the tile.
        return {};
      case "uptimestrip":
        return {
          hours: Number(form.hours),
          blocks: Number(form.blocks),
          items: form.services.split("\n").map((n) => n.trim()).filter(Boolean),
          limit: Number(form.limit),
        };
      case "system":
      case "disks":
        return { instance: form.instance, rangeMinutes: Number(form.rangeMinutes) };
      case "clock":
        return { timeZone: form.timeZone };
      case "slideshow":
        return {
          images: form.images.split("\n").map((line) => line.trim()).filter(Boolean),
          intervalSeconds: Number(form.intervalSeconds),
          caption: form.caption,
          fit: form.fit,
        };
      case "load":
        return {
          containers: form.containersFilter.split("\n").map((n) => n.trim()).filter(Boolean),
          sortBy: form.sortBy,
          limit: Number(form.limit),
        };
      case "notes":
        return { text: form.text };
      case "links":
        return { links: form.linksText };
      default:
        return {};
    }
  }

  const isTile = kind === "service" || kind === "link";
  const isSection = kind === "section";
  // Adding a container is a one-click step: the grid and nothing else. Editing
  // one, or adding anything else, is a form.
  const containerStep = mode === "add" && kind === "service";
  // Folders have no size field: they are resized by dragging their corner like
  // everything else, and asking for a number up front only adds a decision.
  const isFolder = kind === "folder";

  return (
    <Dialog open onClose={onClose} title={mode === "add" ? d.dashboard.addTitle : d.common.edit} wide>
      <div className="flex flex-col gap-4">
        {mode === "add" && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <KindCard active={kind === "service"} onClick={() => setKind("service")} title={d.dashboard.addContainer} hint={d.dashboard.addContainerHint} icon={<KindIcon kind="service" />} />
            <KindCard active={kind === "link"} onClick={() => setKind("link")} title={d.dashboard.addLink} hint={d.dashboard.addLinkHint} icon={<KindIcon kind="link" />} />
            <KindCard active={kind === "folder"} onClick={() => setKind("folder")} title={d.dashboard.addFolder} hint={d.dashboard.addFolderHint} icon={<KindIcon kind="folder" />} />
            <KindCard
              active={kind === "widget"}
              onClick={() => {
                setKind("widget");
                if (!form.title.trim()) set("title", d.widgets[form.widget as keyof typeof d.widgets]);
              }}
              title={d.dashboard.addWidget}
              hint={d.dashboard.addWidgetHint}
              icon={<KindIcon kind="widget" />}
            />
            <KindCard active={kind === "section"} onClick={() => setKind("section")} title={d.dashboard.addSection} hint={d.dashboard.addSectionHint} icon={<KindIcon kind="section" />} />
          </div>
        )}

        {/* Editing a tile that is already bound to a container does not ask the
            question again: the container is shown, with one link to change it.
            "Something of my own" belongs to adding — offering it here invited
            turning a container tile into a plain link by accident, which loses
            the binding that makes the tile know how to check itself. */}
        {kind === "service" && mode === "edit" && form.containerName && !rebinding ? (
          <BoundContainer
            d={d}
            container={containers.find((c) => c.name === form.containerName)}
            name={form.containerName}
            hostKey={form.hostKey}
            onChange={() => setRebinding(true)}
          />
        ) : (
          kind === "service" && (
            <ContainerPicker
              d={d}
              containers={containers}
              selected={form.containerName}
              onPick={(name) => {
                pickContainer(name);
                setRebinding(false);
              }}
              onOwn={mode === "add" ? () => setKind("link") : undefined}
            />
          )
        )}

        {/* What else the tile may carry. Every one of these is something the
            panel already knows about the container and was throwing away. */}
        {kind === "service" && form.containerName && (
          <fieldset>
            <legend className="mb-1 block text-xs font-medium text-muted">{d.dashboard.extras}</legend>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              <Extra label={d.dashboard.extraStats} hint={d.dashboard.extraStatsHint} checked={form.showStats} onChange={(v) => set("showStats", v)} />
              <Extra label={d.dashboard.extraControls} hint={d.dashboard.extraControlsHint} checked={form.showControls} onChange={(v) => set("showControls", v)} />
              <Extra label={d.dashboard.extraUptime} hint={d.dashboard.extraUptimeHint} checked={form.showUptime} onChange={(v) => set("showUptime", v)} />
              <Extra label={d.dashboard.extraPorts} hint={d.dashboard.extraPortsHint} checked={form.showPorts} onChange={(v) => set("showPorts", v)} />
              <Extra label={d.dashboard.extraImage} hint={d.dashboard.extraImageHint} checked={form.showImage} onChange={(v) => set("showImage", v)} />
            </div>
          </fieldset>
        )}

        {!containerStep && (
          <Field label={d.dashboard.tileTitle}>
            <Input value={form.title} onChange={(e) => set("title", e.target.value)} autoFocus />
          </Field>
        )}

        {isSection && (
          <Field label={d.dashboard.tileSubtitle}>
            <Input value={form.subtitle} onChange={(e) => set("subtitle", e.target.value)} />
          </Field>
        )}

        {isFolder && (
          <>
            <Field label={d.dashboard.folderDisplay} hint={d.dashboard.folderDisplayHint}>
              <Select value={form.folderDisplay} onChange={(e) => set("folderDisplay", e.target.value)}>
                <option value="folder">{d.dashboard.displayFolder}</option>
                <option value="panel">{d.dashboard.displayPanel}</option>
              </Select>
            </Field>
            {form.folderDisplay !== "panel" && (
              <Field label={d.dashboard.folderDetail} hint={d.dashboard.folderDetailHint}>
                <Select value={form.detail} onChange={(e) => set("detail", e.target.value)}>
                  <option value="none">{d.common.none}</option>
                  <option value="status">{d.dashboard.detailStatus}</option>
                  <option value="latency">{d.dashboard.detailLatency}</option>
                  <option value="uptime">{d.dashboard.detailUptime}</option>
                  <option value="host">{d.dashboard.detailHost}</option>
                  <option value="container">{d.dashboard.detailContainer}</option>
                </Select>
              </Field>
            )}
          </>
        )}

        {kind === "widget" && (
          <>
            <Field label={d.widgets.pick}>
              <WidgetPicker
                d={d}
                value={form.widget}
                onChange={(w) => {
                  // Fill the title from the widget's name, but only while it is
                  // still empty or still the previous widget's auto-name — a
                  // title the operator typed is never overwritten.
                  const prev = d.widgets[form.widget as keyof typeof d.widgets];
                  if (!form.title.trim() || form.title === prev) set("title", d.widgets[w]);
                  set("widget", w);
                }}
                collapsed={mode === "edit"}
              />
            </Field>

            {form.widget === "chart" && (
              <>
                <Field label={d.widgets.query}>
                  <MetricPicker
                    d={d}
                    query={form.query}
                    instance={form.instance}
                    onChange={(next) =>
                      setForm((f) => ({
                        ...f,
                        query: next.query,
                        instance: next.instance ?? f.instance,
                        unit: next.unit ?? f.unit,
                      }))
                    }
                  />
                </Field>
                <Field label={d.widgets.secondQuery} hint={d.widgets.secondQueryHint}>
                  <Input value={form.query2} onChange={(e) => set("query2", e.target.value)} className="font-mono text-xs" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={d.widgets.unit}>
                    <Select value={form.unit} onChange={(e) => set("unit", e.target.value)}>
                      <option value="number">{d.widgets.unitNumber}</option>
                      <option value="percent">{d.widgets.unitPercent}</option>
                      <option value="bytes">{d.widgets.unitBytes}</option>
                    </Select>
                  </Field>
                  <Field label={d.widgets.range}>
                    <Select value={String(form.rangeMinutes)} onChange={(e) => set("rangeMinutes", Number(e.target.value))}>
                      <option value="60">1 h</option>
                      <option value="180">3 h</option>
                      <option value="720">12 h</option>
                      <option value="1440">24 h</option>
                      <option value="10080">7 d</option>
                    </Select>
                  </Field>
                </div>
              </>
            )}

            {(form.widget === "system" || form.widget === "disks") && (
              <Field label="instance" hint="node_exporter target, e.g. 192.168.0.10:9100 — empty means all">
                <Input value={form.instance} onChange={(e) => set("instance", e.target.value)} className="font-mono" />
              </Field>
            )}

            {form.widget === "clock" && (
              <Field label="Time zone" hint="Europe/Moscow — empty means the browser's own">
                <Input value={form.timeZone} onChange={(e) => set("timeZone", e.target.value)} className="font-mono" />
              </Field>
            )}

            {form.widget === "gauge" && (
              <>
                <Field label={d.widgets.query}>
                  <MetricPicker
                    d={d}
                    query={form.query}
                    instance={form.instance}
                    onChange={(next) =>
                      setForm((f) => ({
                        ...f,
                        query: next.query,
                        instance: next.instance ?? f.instance,
                        unit: next.unit ?? f.unit,
                        max: next.max ?? f.max,
                      }))
                    }
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={d.widgets.unit}>
                    <Select value={form.unit} onChange={(e) => set("unit", e.target.value)}>
                      <option value="percent">{d.widgets.unitPercent}</option>
                      <option value="number">{d.widgets.unitNumber}</option>
                      <option value="bytes">{d.widgets.unitBytes}</option>
                    </Select>
                  </Field>
                  <Field label={d.widgets.caption}>
                    <Input value={form.caption} onChange={(e) => set("caption", e.target.value)} />
                  </Field>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <Field label={d.widgets.minValue}>
                    <Input type="number" value={form.min} onChange={(e) => set("min", Number(e.target.value))} />
                  </Field>
                  <Field label={d.widgets.maxValue}>
                    <Input type="number" value={form.max} onChange={(e) => set("max", Number(e.target.value))} />
                  </Field>
                  <Field label={d.widgets.warnAt}>
                    <Input type="number" value={form.warn} onChange={(e) => set("warn", Number(e.target.value))} />
                  </Field>
                  <Field label={d.widgets.dangerAt}>
                    <Input type="number" value={form.danger} onChange={(e) => set("danger", Number(e.target.value))} />
                  </Field>
                </div>
              </>
            )}

            {(form.widget === "weather" || form.widget === "airquality") && (
              <Field label={d.widgets.place} hint={d.widgets.weatherPick}>
                <PlacePicker
                  d={d}
                  value={form.place}
                  onPick={(p) =>
                    setForm((f) => ({
                      ...f,
                      place: p.name,
                      latitude: String(p.latitude),
                      longitude: String(p.longitude),
                      title: f.title || p.name,
                    }))
                  }
                />
              </Field>
            )}

            {form.widget === "uptimestrip" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={d.widgets.hours}>
                    <Input type="number" min={1} value={form.hours} onChange={(e) => set("hours", Number(e.target.value))} />
                  </Field>
                  <Field label={d.widgets.limit}>
                    <Input type="number" min={1} max={20} value={form.limit} onChange={(e) => set("limit", Number(e.target.value))} />
                  </Field>
                </div>
                <Field label={d.widgets.onlyServices} hint={d.widgets.onlyServicesHint}>
                  <Textarea rows={3} value={form.services} onChange={(e) => set("services", e.target.value)} className="text-xs" />
                </Field>
              </>
            )}

            {form.widget === "homeassistant" && (
              <Field label={d.services.haEntities} hint={d.services.haPickerHint}>
                <HaEntityPicker
                  d={d}
                  value={form.entities.split("\n").map((e) => e.trim()).filter(Boolean)}
                  onChange={(ids) => set("entities", ids.join("\n"))}
                />
              </Field>
            )}

            {form.widget === "homegroups" && (
              <>
                <Field label={d.widgets.homeGroupBy}>
                  <Select
                    value={form.homeGroupBy}
                    onChange={(e) => {
                      set("homeGroupBy", e.target.value);
                      set("homeGroups", []); // the sections differ between modes
                    }}
                  >
                    <option value="area">{d.home.byRoom}</option>
                    <option value="device">{d.home.byDevice}</option>
                  </Select>
                </Field>
                <Field label={d.widgets.homegroups} hint={d.widgets.homeGroupsHint}>
                  <HomeGroupSelect d={d} groupBy={form.homeGroupBy} value={form.homeGroups} onChange={(ids) => set("homeGroups", ids)} />
                </Field>
              </>
            )}

            {form.widget === "energy" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label={d.widgets.energyPrice} hint={d.widgets.energyPriceHint}>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    value={form.price}
                    onChange={(e) => set("price", e.target.value)}
                    placeholder="0"
                  />
                </Field>
                <Field label={d.widgets.energyCurrency}>
                  <Input value={form.currency} onChange={(e) => set("currency", e.target.value)} className="w-20" />
                </Field>
              </div>
            )}

            {form.widget === "habits" && (
              <Field label={d.widgets.habitsList} hint={d.widgets.habitsHint}>
                <Textarea
                  rows={5}
                  value={form.habitsList}
                  onChange={(e) => set("habitsList", e.target.value)}
                  placeholder={"Зарядка\nВитамины\nЧтение"}
                />
              </Field>
            )}

            {form.widget === "cameras" && (
              <>
                <Field label={d.widgets.cameras} hint={d.widgets.camerasHint}>
                  <HaEntityPicker
                    d={d}
                    only="camera"
                    value={form.entities.split("\n").map((e) => e.trim()).filter(Boolean)}
                    onChange={(ids) => set("entities", ids.join("\n"))}
                  />
                </Field>
                <Field label={`${d.widgets.camerasRefresh}, ${d.dashboard.seconds}`}>
                  <Input type="number" min={2} value={form.refreshSeconds} onChange={(e) => set("refreshSeconds", Number(e.target.value))} className="w-24" />
                </Field>
              </>
            )}

            {(form.widget === "feed" || form.widget === "embed" || form.widget === "ical") && (
              <>
                <Field
                  label={d.widgets.url}
                  hint={form.widget === "feed" ? d.widgets.feedUrlHint : form.widget === "ical" ? d.widgets.icalUrlHint : d.widgets.embedUrlHint}
                >
                  <Input
                    value={form.feedUrl}
                    onChange={(e) => set("feedUrl", e.target.value)}
                    placeholder={form.widget === "feed" ? "https://…/releases.atom" : form.widget === "ical" ? "https://…/calendar.ics" : "https://…"}
                    className="font-mono text-xs"
                  />
                </Field>
                {(form.widget === "feed" || form.widget === "ical") && (
                  <Field label={d.widgets.limit}>
                    <Input type="number" min={1} max={30} value={form.limit} onChange={(e) => set("limit", Number(e.target.value))} />
                  </Field>
                )}
              </>
            )}

            {form.widget === "wol" && (
              <Field label={d.widgets.wolMachines} hint={d.widgets.wolMachinesHint}>
                <Textarea
                  rows={4}
                  value={form.wolMachines}
                  onChange={(e) => set("wolMachines", e.target.value)}
                  className="font-mono text-xs"
                  placeholder={"Desktop | AA:BB:CC:DD:EE:FF\nNAS | 11:22:33:44:55:66 | 192.168.0.255"}
                />
              </Field>
            )}

            {form.widget === "rates" && (
              <>
                <Field label={d.widgets.ratesBase}>
                  <Input value={form.ratesBase} onChange={(e) => set("ratesBase", e.target.value)} placeholder="USD" className="font-mono text-xs uppercase" />
                </Field>
                <Field label={d.widgets.ratesSymbols} hint={d.widgets.ratesSymbolsHint}>
                  <Textarea
                    rows={3}
                    value={form.ratesSymbols}
                    onChange={(e) => set("ratesSymbols", e.target.value)}
                    className="font-mono text-xs uppercase"
                    placeholder={"EUR\nRUB\nGBP"}
                  />
                </Field>
              </>
            )}

            {form.widget === "recentevents" && (
              <Field label={d.widgets.limit}>
                <Input type="number" min={1} max={30} value={form.limit} onChange={(e) => set("limit", Number(e.target.value))} />
              </Field>
            )}

            {form.widget === "worldclocks" && (
              <Field label={d.widgets.zones} hint={d.widgets.zonesHint}>
                <Textarea
                  rows={4}
                  value={form.zones}
                  onChange={(e) => set("zones", e.target.value)}
                  className="font-mono text-xs"
                  placeholder={"Europe/Moscow\nAmerica/New_York\nAsia/Tokyo"}
                />
              </Field>
            )}

            {form.widget === "countdown" && (
              <>
                <Field label={d.widgets.countdownLabel}>
                  <Input value={form.countdownLabel} onChange={(e) => set("countdownLabel", e.target.value)} placeholder="New Year" />
                </Field>
                <Field label={d.widgets.countdownTarget}>
                  <Input type="datetime-local" value={form.countdownTarget} onChange={(e) => set("countdownTarget", e.target.value)} />
                </Field>
              </>
            )}

            {form.widget === "sla" && (
              <>
                <Field label={d.widgets.onlyServices} hint={d.widgets.onlyServicesHint}>
                  <Textarea rows={3} value={form.services} onChange={(e) => set("services", e.target.value)} className="text-xs" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={d.widgets.hours}>
                    <Input type="number" min={1} value={form.hours} onChange={(e) => set("hours", Number(e.target.value))} />
                  </Field>
                  <Field label={d.widgets.limit}>
                    <Input type="number" min={1} max={20} value={form.limit} onChange={(e) => set("limit", Number(e.target.value))} />
                  </Field>
                </div>
              </>
            )}

            {form.widget === "jellyfin" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={d.services.jfSource}>
                    <Select value={form.jfSource} onChange={(e) => set("jfSource", e.target.value)}>
                      <option value="auto">{d.services.jfSourceAuto}</option>
                      <option value="nextup">{d.services.nextUp}</option>
                      <option value="recent">{d.services.recentlyAdded}</option>
                    </Select>
                  </Field>
                  <Field label={d.widgets.limit}>
                    <Input
                      type="number"
                      min={1}
                      max={40}
                      value={form.jfLimit}
                      onChange={(e) => set("jfLimit", Number(e.target.value))}
                    />
                  </Field>
                </div>
                <Extra
                  label={d.services.jfSessions}
                  hint={d.services.jfSessionsHint}
                  checked={form.jfShowSessions}
                  onChange={(v) => set("jfShowSessions", v)}
                />
                <Extra
                  label={d.services.jfCounts}
                  hint={d.services.jfCountsHint}
                  checked={form.jfShowCounts}
                  onChange={(v) => set("jfShowCounts", v)}
                />
              </>
            )}

            {form.widget === "mediaplayer" && (
              <>
                <Field label={d.media.players} hint={d.media.playersHint}>
                  <HaEntityPicker
                    d={d}
                    only="media_player"
                    value={form.entities.split("\n").map((e) => e.trim()).filter(Boolean)}
                    onChange={(ids) => set("entities", ids.join("\n"))}
                  />
                </Field>

                <Field label={d.media.background} hint={d.media.backgroundHint}>
                  <Select value={form.background} onChange={(e) => set("background", e.target.value)}>
                    <option value="drift">{d.media.bgDrift}</option>
                    <option value="aurora">{d.media.bgAurora}</option>
                    <option value="waves">{d.media.bgWaves}</option>
                    <option value="beams">{d.media.bgBeams}</option>
                    <option value="pulse">{d.media.bgPulse}</option>
                    <option value="still">{d.media.bgStill}</option>
                  </Select>
                </Field>

                <Field label={d.media.likePhrase} hint={d.media.likePhraseHint}>
                  <Input
                    value={form.likePhrase}
                    onChange={(e) => set("likePhrase", e.target.value)}
                    placeholder="лайк"
                  />
                </Field>

                {form.likePhrase.trim() !== "" && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={d.media.likeLabel}>
                      <Input value={form.likeLabel} onChange={(e) => set("likeLabel", e.target.value)} placeholder={d.media.like} />
                    </Field>
                    <Field label={d.media.likeService} hint={d.media.likeServiceHint}>
                      <Input
                        value={form.likeService}
                        onChange={(e) => set("likeService", e.target.value)}
                        className="font-mono text-xs"
                        placeholder="media_player.play_media"
                      />
                    </Field>
                  </div>
                )}
              </>
            )}

            {form.widget === "load" && (
              <>
                <Field label={d.widgets.onlyContainers} hint={d.widgets.onlyContainersHint}>
                  <Textarea
                    rows={3}
                    value={form.containersFilter}
                    onChange={(e) => set("containersFilter", e.target.value)}
                    className="font-mono text-xs"
                    placeholder="jellyfin"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={d.widgets.sortBy}>
                    <Select value={form.sortBy} onChange={(e) => set("sortBy", e.target.value)}>
                      <option value="cpu">{d.monitoring.cpu}</option>
                      <option value="memory">{d.monitoring.memory}</option>
                    </Select>
                  </Field>
                  <Field label={d.widgets.limit}>
                    <Input type="number" min={1} max={20} value={form.limit} onChange={(e) => set("limit", Number(e.target.value))} />
                  </Field>
                </div>
              </>
            )}

            {form.widget === "slideshow" && (
              <>
                <Field label={d.widgets.images} hint={d.widgets.imagesHint}>
                  <Textarea
                    rows={4}
                    value={form.images}
                    onChange={(e) => set("images", e.target.value)}
                    className="font-mono text-xs"
                    placeholder="https://…/photo.jpg"
                  />
                </Field>
                {/* Uploading appends to the list rather than replacing it, so a
                    slideshow can be built one picture at a time. */}
                <ImagePicker
                  d={d}
                  value=""
                  onChange={(url) => set("images", form.images ? `${form.images}\n${url}` : url)}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Field label={`${d.widgets.interval}, ${d.dashboard.seconds}`}>
                    <Input
                      type="number"
                      min={3}
                      value={form.intervalSeconds}
                      onChange={(e) => set("intervalSeconds", Number(e.target.value))}
                    />
                  </Field>
                  <Field label={d.widgets.fit}>
                    <Select value={form.fit} onChange={(e) => set("fit", e.target.value)}>
                      <option value="cover">{d.widgets.fitCover}</option>
                      <option value="contain">{d.widgets.fitContain}</option>
                    </Select>
                  </Field>
                </div>
                <Field label={d.widgets.caption}>
                  <Input value={form.caption} onChange={(e) => set("caption", e.target.value)} />
                </Field>
              </>
            )}

            {form.widget === "notes" && (
              <Field label={d.widgets.noteText}>
                <Textarea rows={4} value={form.text} onChange={(e) => set("text", e.target.value)} />
              </Field>
            )}

            {form.widget === "links" && (
              <Field label={d.widgets.linksField} hint={d.widgets.linksHint}>
                <Textarea
                  rows={5}
                  value={form.linksText}
                  onChange={(e) => set("linksText", e.target.value)}
                  className="font-mono text-xs"
                  placeholder={"Router | 192.168.0.1\nNAS | http://192.168.0.10:5000\nWiki | https://wiki.local"}
                />
              </Field>
            )}
          </>
        )}

        {isTile && !containerStep && (
          <>
            <Field label={d.dashboard.tileUrl}>
              <Input
                value={form.url}
                onChange={(e) => set("url", e.target.value)}
                // Fill the icon in once there is an address to guess from, but
                // never overwrite one the user chose.
                onBlur={() => {
                  if (form.icon) return;
                  const guess = autoIcon({ name: form.title, url: form.url });
                  if (guess) set("icon", guess);
                }}
                placeholder="http://192.168.0.10:8096"
                className="font-mono"
              />
            </Field>
            <Field label={d.dashboard.tileInternalUrl} hint={d.dashboard.tileInternalUrlHint}>
              <Input value={form.internalUrl} onChange={(e) => set("internalUrl", e.target.value)} className="font-mono" />
            </Field>
            <Field label={d.dashboard.tileSubtitle}>
              <Input value={form.subtitle} onChange={(e) => set("subtitle", e.target.value)} />
            </Field>
          </>
        )}

        {kind !== "widget" && !containerStep && (
          <Field label={d.dashboard.tileIcon}>
            <IconPicker
              d={d}
              value={form.icon}
              onChange={(icon) => set("icon", icon)}
              hintName={form.containerName || form.title}
              online={iconPack}
            />
          </Field>
        )}

        {isTile && !containerStep && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={d.dashboard.tileCheck}>
              <Select value={form.checkKind} onChange={(e) => set("checkKind", e.target.value)}>
                <option value="none">{d.dashboard.checkNone}</option>
                <option value="http">{d.dashboard.checkHttp}</option>
                <option value="docker">{d.dashboard.checkDocker}</option>
              </Select>
            </Field>
            <Field label={`${d.dashboard.checkInterval}, ${d.dashboard.seconds}`}>
              <Input
                type="number"
                min={15}
                value={form.checkInterval}
                onChange={(e) => set("checkInterval", Number(e.target.value))}
              />
            </Field>
          </div>
        )}

        {!containerStep && !isFolder && !isSection && kind !== "widget" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={d.dashboard.tileWidth}>
            <Select value={String(form.w)} onChange={(e) => set("w", Number(e.target.value))}>
              {[2, 3, 4, 6, 8, 12].map((w) => (
                <option key={w} value={w}>
                  {w}/12
                </option>
              ))}
            </Select>
          </Field>
          {/* `kind` is already known not to be a folder in this branch. */}
          {folders.length > 0 && (
            <Field label={d.dashboard.addFolder}>
              <Select value={form.parentId} onChange={(e) => set("parentId", e.target.value)}>
                <option value="">—</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        )}

        {isTile && !containerStep && (
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={form.newTab} onChange={(e) => set("newTab", e.target.checked)} />
            {d.dashboard.tileOpenNewTab}
          </label>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="quiet" onClick={onClose}>
            {d.common.cancel}
          </Button>
          {!containerStep && (
            <Button variant="primary" onClick={submit} disabled={pending || !form.title.trim()}>
              {d.common.save}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Containers as a grid of tiles rather than a dropdown.
 *
 * You pick a container by recognising it, and a list of thirty names in a
 * select is the one shape that makes that hard. The first cell adds something
 * of your own — anything not running here, or not a container at all — and the
 * ones already on a dashboard sit at the end, marked, so they are still
 * reachable without being in the way.
 */
function ContainerPicker({
  d,
  containers,
  selected,
  onPick,
  onOwn,
}: {
  d: Dictionary;
  containers: ContainerOption[];
  selected: string;
  onPick: (name: string) => void;
  /** Omitted while editing: see the call site. */
  onOwn?: () => void;
}) {
  const sorted = [...containers].sort((a, b) => {
    if (!!a.onDashboard !== !!b.onDashboard) return a.onDashboard ? 1 : -1;
    // Running first among the rest: a stopped container is rarely the one
    // being looked for.
    if ((a.state === "running") !== (b.state === "running")) return a.state === "running" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-muted">{d.dashboard.addContainer}</span>
      <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
        {onOwn && (
          <button
            type="button"
            onClick={onOwn}
            className="flex flex-col items-center justify-center gap-1 rounded-control border border-dashed border-line px-2 py-3 text-center transition-colors hover:border-accent hover:bg-raised"
          >
            <span className="text-lg leading-none" aria-hidden>
              +
            </span>
            <span className="text-xs font-medium">{d.dashboard.ownService}</span>
          </button>
        )}

        {sorted.map((c) => {
          const active = c.name === selected;
          return (
            <button
              key={`${c.hostKey}/${c.name}`}
              type="button"
              onClick={() => onPick(c.name)}
              title={`${c.name} · ${c.hostLabel} · ${c.state}`}
              className={`flex items-center gap-2 rounded-control border px-2 py-2 text-left transition-colors ${
                active ? "border-accent bg-accent/10" : "border-line hover:bg-raised"
              } ${c.onDashboard ? "opacity-55" : ""}`}
            >
              <TileIcon
                icon={c.icon || iconPackUrl({ name: c.name, image: c.image })}
                title={c.name}
                size="sm"
                fallback={guessIcon({ name: c.name, image: c.image }) || GLYPH.container}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{c.name}</span>
                <span className="block truncate text-[10px] text-faint">
                  {c.onDashboard ? d.containers.onDashboard : c.state}
                </span>
              </span>
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.state === "running" ? "bg-ok" : "bg-faint"}`}
                aria-hidden
              />
            </button>
          );
        })}
      </div>
      {containers.length === 0 && <p className="mt-1 text-xs text-faint">{d.containers.noDocker}</p>}
    </div>
  );
}

/**
 * The container an existing tile is bound to.
 *
 * Shown instead of the grid when editing, because the question "which
 * container?" was answered when the tile was made. What matters now is that the
 * answer is visible — with the host and the current state, so a tile pointing
 * at something that no longer exists says so — and that changing it takes one
 * deliberate click.
 */
function BoundContainer({
  d,
  container,
  name,
  hostKey,
  onChange,
}: {
  d: Dictionary;
  container?: ContainerOption;
  name: string;
  hostKey: string;
  onChange: () => void;
}) {
  const missing = !container;

  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-muted">{d.dashboard.addContainer}</span>
      <div className="flex items-center gap-2 rounded-control border border-line p-2">
        <TileIcon
          icon={container?.icon || iconPackUrl({ name, image: container?.image })}
          title={name}
          size="sm"
          fallback={guessIcon({ name, image: container?.image }) || GLYPH.container}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{name}</span>
          <span className="block truncate text-[11px] text-faint">
            {missing ? d.dashboard.containerMissing : `${container.hostLabel} · ${container.state}`}
          </span>
        </span>
        {!missing && (
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${container.state === "running" ? "bg-ok" : "bg-faint"}`}
            aria-hidden
          />
        )}
        <Button size="sm" variant="quiet" onClick={onChange}>
          {d.common.change}
        </Button>
      </div>
      {hostKey && <span className="mt-1 block text-[10px] text-faint">{hostKey}</span>}
    </div>
  );
}

/** One switchable extra, with the reason to want it written next to it. */
function Extra({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-control border border-line px-2 py-1.5 transition-colors hover:bg-raised">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-xs font-medium">{label}</span>
        <span className="block text-[11px] leading-snug text-faint">{hint}</span>
      </span>
    </label>
  );
}

function KindCard({
  active,
  onClick,
  title,
  hint,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  hint: string;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-control border p-2.5 text-left transition-colors ${
        active ? "border-accent bg-accent/10" : "border-line hover:bg-raised"
      }`}
    >
      <span className={`mb-1 block ${active ? "text-accent" : "text-muted"}`}>{icon}</span>
      <span className="block text-sm font-medium">{title}</span>
      <span className="mt-0.5 block text-[11px] leading-snug text-muted">{hint}</span>
    </button>
  );
}

/**
 * Choose which smart-home groups the Home-groups widget shows.
 *
 * The groups are the hand-made ones from the smart-home page; they are fetched
 * on open rather than threaded through the whole add flow, so this works the
 * same whether the widget is being created or edited. Nothing checked means all
 * of them, which is the sensible default for a fresh widget.
 */
function HomeGroupSelect({
  d,
  value,
  onChange,
  groupBy = "area",
}: {
  d: Dictionary;
  value: string[];
  onChange: (ids: string[]) => void;
  groupBy?: string;
}) {
  const [groups, setGroups] = useState<{ id: string; name: string; icon?: string }[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setGroups(null);
    void listHomeGroups(groupBy === "device" ? "device" : "area").then((g) => {
      if (!cancelled) setGroups(g);
    });
    return () => {
      cancelled = true;
    };
  }, [groupBy]);

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  }

  if (groups === null) return <p className="text-xs text-muted">{d.common.loading}</p>;
  if (groups.length === 0) return <p className="text-xs text-muted">{d.widgets.noHomeGroups}</p>;

  return (
    <div className="space-y-0.5 rounded-control border border-line p-1">
      {groups.map((g) => (
        <label key={g.id} className="flex items-center gap-2 rounded-control px-2 py-1 text-sm hover:bg-raised">
          <input type="checkbox" checked={value.includes(g.id)} onChange={() => toggle(g.id)} />
          {g.icon && <span aria-hidden>{g.icon}</span>}
          <span className="truncate">{g.name}</span>
        </label>
      ))}
    </div>
  );
}

/** Line icons for the five kinds of thing a dashboard can hold. */
function KindIcon({ kind }: { kind: Kind }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "h-5 w-5",
    "aria-hidden": true,
  };
  switch (kind) {
    case "service":
      return (
        <svg {...common}>
          <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" />
          <path d="M3 7.5 12 12l9-4.5M12 12v9" />
        </svg>
      );
    case "link":
      return (
        <svg {...common}>
          <path d="M9 15l6-6" />
          <path d="M11 6.5 12.5 5a4 4 0 0 1 5.7 5.7l-1.5 1.5" />
          <path d="M13 17.5 11.5 19a4 4 0 0 1-5.7-5.7l1.5-1.5" />
        </svg>
      );
    case "folder":
      return (
        <svg {...common}>
          <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5z" />
        </svg>
      );
    case "widget":
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "section":
      return (
        <svg {...common}>
          <path d="M4 6h16M4 11h10M4 16h13" />
        </svg>
      );
    default:
      return null;
  }
}

function parseConfig(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
