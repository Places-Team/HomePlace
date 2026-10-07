"use client";

import { useMemo, useState } from "react";
import { deviceGraph, filterDevices, PLATFORM_NAMES, type DeviceView } from "@/lib/deviceWorkspace";
import { DeviceGraph } from "./DeviceGraph";
import { DeviceDetails } from "./DeviceDetails";
import { AccountIcon, DeviceLogo, GraphIcon, ListIcon, useDeviceTimeZone } from "./DeviceIdentity";
import { SearchIcon } from "@/components/NavIcons";
import type { Dictionary } from "@/i18n";

export function DevicesWorkspace({ devices, serverUrl, d, ru }: {
  devices: DeviceView[]; serverUrl: string; d: Pick<Dictionary, "devices" | "common">; ru: boolean;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "online" | "offline">("all");
  const [mode, setMode] = useState<"graph" | "list">("graph");
  const [selected, setSelected] = useState("server");
  const [copyNotice, setCopyNotice] = useState("");
  const timeZone = useDeviceTimeZone();
  const say = (en: string, russian: string) => ru ? russian : en;
  const filtered = useMemo(() => filterDevices(devices, query, status), [devices, query, status]);
  const graph = useMemo(() => deviceGraph(filtered), [filtered]);
  const effectiveSelected = graph.nodes.some(node => node.id === selected) ? selected : "server";
  const selectedNode = graph.nodes.find(node => node.id === effectiveSelected)!;
  const device = selectedNode.deviceId ? devices.find(device => device.id === selectedNode.deviceId) : null;
  const online = devices.filter(device => device.online).length;
  const accountCount = new Set(devices.map(device => device.ownerId).filter(Boolean)).size;
  const owned = selectedNode.kind === "account" ? filtered.filter(device => device.ownerId === selectedNode.ownerId) : [];
  const date = (date: string | null) => date ? new Date(date).toLocaleString(ru ? "ru-RU" : "en-US", { dateStyle: "short", timeStyle: "short", timeZone }) : d.devices.neverConnected;

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-center gap-6">
        <div><p className="text-2xl font-semibold tracking-tight tabular-nums">{devices.length}<span className="ml-2 text-sm font-normal text-muted">{say("devices", "устройства")}</span></p></div>
        <div className="flex items-center gap-2 text-sm text-muted"><span className="h-2 w-2 rounded-full bg-ok" /><span className="font-semibold tabular-nums text-text">{online}</span>{say("online", "в сети")}</div>
        <span className="hidden text-sm text-muted sm:inline">{say(`Accounts: ${accountCount}`, `Аккаунтов: ${accountCount}`)}</span>
      </div>
      <div className="flex gap-1 rounded-control bg-raised p-1" aria-label={say("Device view", "Вид устройств")}>
        <button type="button" aria-pressed={mode === "graph"} onClick={() => setMode("graph")} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${mode === "graph" ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text"}`}><GraphIcon className="h-4 w-4" />{say("Map", "Карта связей")}</button>
        <button type="button" aria-pressed={mode === "list"} onClick={() => setMode("list")} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${mode === "list" ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text"}`}><ListIcon className="h-4 w-4" />{say("List", "Список")}</button>
      </div>
    </div>
    <div className="flex flex-wrap gap-3">
      <label className="relative min-w-0 flex-1"><SearchIcon className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" />
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} aria-label={say("Search devices", "Поиск устройств")}
          placeholder={say("Device, account or platform", "Устройство, аккаунт или платформа")} className="w-full rounded-control border border-line bg-surface py-2.5 pl-9 pr-3 text-sm text-text placeholder:text-muted" />
      </label>
      <select aria-label={say("Availability filter", "Фильтр доступности")} value={status} onChange={event => setStatus(event.target.value as typeof status)} className="rounded-control border border-line bg-surface px-3 py-2.5 text-sm text-text">
        <option value="all">{say("All devices", "Все устройства")}</option><option value="online">{say("Online", "В сети")}</option><option value="offline">{say("Offline", "Нет связи")}</option>
      </select>
      {(query || status !== "all") && <button type="button" className="px-2 text-sm text-muted hover:text-text" onClick={() => { setQuery(""); setStatus("all"); }}>{say("Clear", "Сбросить")}</button>}
    </div>
    {devices.length === 0 && <p className="rounded-card border border-dashed border-line p-8 text-center text-sm text-muted">{d.devices.empty}</p>}
    {devices.length > 0 && filtered.length === 0 && <p role="status" className="py-6 text-center text-sm text-muted">{say("No devices match this search.", "Нет устройств по этому запросу.")}</p>}
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0">
        {mode === "graph" ? <DeviceGraph devices={filtered} selected={effectiveSelected} onSelect={setSelected} serverUrl={serverUrl} ru={ru} />
          : <section aria-label={say("Device list", "Список устройств")} className="overflow-hidden rounded-card border border-line bg-surface">
            {filtered.map(device => <button key={device.id} type="button" aria-pressed={effectiveSelected === `device:${device.id}`} onClick={() => setSelected(`device:${device.id}`)}
              className={`flex w-full items-center gap-4 border-b border-line p-4 text-left transition-colors last:border-b-0 hover:bg-raised ${effectiveSelected === `device:${device.id}` ? "bg-accent/5" : ""}`}>
              <DeviceLogo platform={device.platform} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{device.name}</span><span className="mt-1 block truncate text-xs text-muted">{PLATFORM_NAMES[device.platform] ?? device.platform} · {device.ownerName ?? d.devices.unassigned}</span></span>
              <span className="hidden text-right text-xs text-muted md:block"><span className="block">{say("Last seen", "Последняя связь")}</span><time dateTime={device.lastSeenAt ?? undefined} className="mt-1 block tabular-nums">{date(device.lastSeenAt)}</time></span>
              <span className={`shrink-0 text-xs font-medium ${device.online ? "text-ok" : "text-muted"}`}>{device.online ? d.devices.online : d.devices.offline}</span>
            </button>)}
          </section>}
      </div>
      {device ? <DeviceDetails key={device.id} device={device} d={d} ru={ru} />
        : <aside aria-label={say("Connection details", "Сведения о привязке")} className="rounded-card border border-line bg-surface p-5">
          <div className="flex items-center gap-3">
            {selectedNode.kind === "server"
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src="/icon-192.png" alt="" className="h-12 w-12 rounded-xl" />
              : <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-raised text-muted"><AccountIcon className="h-6 w-6" /></span>}
            <div className="min-w-0"><h2 className="truncate text-lg font-semibold">{selectedNode.kind === "server" ? "HomePlace" : owned[0]?.ownerName ?? d.devices.unassigned}</h2>
              <p className="mt-1 text-sm text-muted">{selectedNode.kind === "server" ? say("Server bindings", "Привязки сервера") : say("Account devices", "Устройства аккаунта")}</p></div>
          </div>
          {selectedNode.kind === "server" ? <>
            <p className="mt-5 text-xs text-muted">{d.devices.serverAddress}</p><code className="mt-2 block select-all break-all rounded-control bg-raised p-3 text-sm">{serverUrl}</code>
            <button type="button" className="mt-2 text-sm text-accent hover:underline" onClick={async () => {
              try { await navigator.clipboard.writeText(serverUrl); setCopyNotice(say("Address copied.", "Адрес скопирован.")); }
              catch { setCopyNotice(say("Select the address above and copy it manually.", "Выделите адрес выше и скопируйте вручную.")); }
            }}>{say("Copy address", "Скопировать адрес")}</button>
            {copyNotice && <p role="status" className="mt-2 text-xs text-muted">{copyNotice}</p>}
            <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4"><div><dt className="text-xs text-muted">{say("Accounts", "Аккаунты")}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{accountCount}</dd></div><div><dt className="text-xs text-muted">{say("Devices", "Устройства")}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{devices.length}</dd></div></dl>
            <p className="mt-5 text-sm leading-relaxed text-muted">{say("Choose a device to see its information, send content or manage access.", "Выберите устройство, чтобы посмотреть сведения, отправить материалы или настроить доступ.")}</p>
          </> : <div className="mt-5 space-y-2">{owned.map(device => <button key={device.id} type="button" onClick={() => setSelected(`device:${device.id}`)} className="flex w-full items-center gap-3 rounded-control p-2 text-left hover:bg-raised">
            <DeviceLogo platform={device.platform} className="h-9 w-9" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{device.name}</span><span className="text-xs text-muted">{PLATFORM_NAMES[device.platform] ?? device.platform}</span></span><span className={`h-2 w-2 rounded-full ${device.online ? "bg-ok" : "bg-muted/50"}`} aria-label={device.online ? d.devices.online : d.devices.offline} />
          </button>)}</div>}
        </aside>}
    </div>
  </div>;
}
