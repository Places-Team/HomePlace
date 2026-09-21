"use client";

import { useState, useTransition } from "react";
import { Card, CardHeader, Badge } from "@/components/ui";
import { Field, Input, Select, Button } from "@/components/form";
import {
  saveJellyfinSettings,
  saveOverseerrSettings,
  saveQbitSettings,
  saveArrSettings,
  savePbsSettings,
  saveHaSettings,
  type ServiceResult,
} from "@/actions/services";
import { addServiceWidget } from "@/actions/dashboard";
import { SecretField } from "./SecretField";
import type { Dictionary } from "@/i18n";
import { Dialog } from "@/components/Dialog";
import { TileIcon } from "@/components/TileIcon";
import { SERVICE_ICONS, serviceLogo } from "@/lib/icons";
import { SettingsFold } from "./SettingsFold";

/**
 * The services this household runs.
 *
 * All five follow the same shape — address, credential, save — because they
 * are the same job five times, and a page where each one is arranged
 * differently is a page nobody finishes reading. Saving performs a real read
 * against the service, so the result line means "it answered", not "it was
 * written down".
 */

export type ServicesDisplay = {
  jellyfin: { url: string; localUrl: string; appUrl: string; cacheLocally: boolean; hasKey: boolean };
  overseerr: { url: string; hasKey: boolean };
  qbittorrent: { url: string; username: string; hasPassword: boolean };
  arr: { kind: string; label: string; url: string; hasKey: boolean }[];
  pbs: { url: string; tokenId: string; hasSecret: boolean; verifyTls: boolean };
  homeassistant: { url: string; hasToken: boolean };
};

export function ServiceForms({ d, display }: { d: Dictionary; display: ServicesDisplay }) {
  type ServiceKey = "jellyfin" | "overseerr" | "qbittorrent" | "arr" | "pbs" | "homeassistant";
  const initiallyVisible: ServiceKey[] = [
    ...(display.jellyfin.url || display.jellyfin.localUrl ? ["jellyfin" as const] : []),
    ...(display.overseerr.url ? ["overseerr" as const] : []),
    ...(display.qbittorrent.url ? ["qbittorrent" as const] : []),
    ...(display.arr.length ? ["arr" as const] : []),
    ...(display.pbs.url ? ["pbs" as const] : []),
    ...(display.homeassistant.url ? ["homeassistant" as const] : []),
  ];
  const [visible, setVisible] = useState<Set<ServiceKey>>(() => new Set(initiallyVisible));
  const [adding, setAdding] = useState(false);
  const [arrKind, setArrKind] = useState("sonarr");

  function show(key: ServiceKey, kind?: string) {
    if (kind) setArrKind(kind);
    setVisible((current) => new Set(current).add(key));
    setAdding(false);
  }

  function hide(key: ServiceKey) {
    setVisible((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }

  const choices = [
    { key: "jellyfin" as const, label: "Jellyfin", logo: "jellyfin" },
    { key: "overseerr" as const, label: "Overseerr", logo: "overseerr" },
    { key: "qbittorrent" as const, label: "qBittorrent", logo: "qbittorrent" },
    { key: "arr" as const, kind: "sonarr", label: "Sonarr", logo: "sonarr" },
    { key: "arr" as const, kind: "radarr", label: "Radarr", logo: "radarr" },
    { key: "arr" as const, kind: "lidarr", label: "Lidarr", logo: "lidarr" },
    { key: "arr" as const, kind: "readarr", label: "Readarr", logo: "readarr" },
    { key: "pbs" as const, label: "Proxmox Backup Server", logo: "pbs" },
    { key: "homeassistant" as const, label: "Home Assistant", logo: "homeassistant" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-4">
        <div><p className="text-sm font-medium">{d.settings.configuredServices}</p><p className="mt-0.5 text-xs text-muted">{d.settings.configuredServicesHint}</p></div>
        <Button variant="primary" onClick={() => setAdding(true)}>＋ {d.settings.addService}</Button>
      </div>
      {visible.size === 0 && <button onClick={() => setAdding(true)} className="w-full rounded-card border border-dashed border-line px-6 py-10 text-center text-sm text-muted transition-colors hover:border-accent hover:text-text">＋ {d.settings.addFirstService}</button>}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {visible.has("jellyfin") && <SettingsFold title="Jellyfin" icon={serviceLogo("jellyfin")} fallback={SERVICE_ICONS.jellyfin} configured={!!(display.jellyfin.url || display.jellyfin.localUrl)}><JellyfinForm d={d} value={display.jellyfin} onRemove={() => hide("jellyfin")} /></SettingsFold>}
        {visible.has("overseerr") && <SettingsFold title="Overseerr" icon={serviceLogo("overseerr")} fallback={SERVICE_ICONS.overseerr} configured={!!display.overseerr.url}><OverseerrForm d={d} value={display.overseerr} onRemove={() => hide("overseerr")} /></SettingsFold>}
        {visible.has("qbittorrent") && <SettingsFold title="qBittorrent" icon={serviceLogo("qbittorrent")} fallback={SERVICE_ICONS.qbittorrent} configured={!!display.qbittorrent.url}><QbitForm d={d} value={display.qbittorrent} onRemove={() => hide("qbittorrent")} /></SettingsFold>}
        {visible.has("arr") && <SettingsFold title="Radarr / Sonarr" icon={serviceLogo(arrKind)} fallback="◉" configured={display.arr.length > 0}><ArrForm d={d} value={display.arr} defaultKind={arrKind} onRemove={() => hide("arr")} /></SettingsFold>}
        {visible.has("pbs") && <SettingsFold title="Proxmox Backup Server" icon={serviceLogo("pbs")} fallback={SERVICE_ICONS.pbs} configured={!!display.pbs.url}><PbsForm d={d} value={display.pbs} onRemove={() => hide("pbs")} /></SettingsFold>}
        {visible.has("homeassistant") && <SettingsFold title="Home Assistant" icon={serviceLogo("homeassistant")} fallback={SERVICE_ICONS.homeassistant} configured={!!display.homeassistant.url}><HaForm d={d} value={display.homeassistant} onRemove={() => hide("homeassistant")} /></SettingsFold>}
      </div>
      <Dialog open={adding} onClose={() => setAdding(false)} title={d.settings.addService} wide>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {choices.map((choice) => <button key={`${choice.key}-${choice.kind ?? ""}`} onClick={() => show(choice.key, choice.kind)} className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-control border border-line p-3 text-center transition-colors hover:border-accent hover:bg-raised"><TileIcon icon={serviceLogo(choice.logo)} title={choice.label} size="lg" fallback={SERVICE_ICONS[choice.logo] ?? "•"} /><span className="text-xs font-medium">{choice.label}</span></button>)}
        </div>
      </Dialog>
    </div>
  );
}

/**
 * "Put it on the board", next to the credentials that make it work.
 *
 * The moment a service is configured is the moment someone wants to see it. The
 * alternative was: leave settings, open the dashboard, press +, choose Widget,
 * find the right one, name it — five steps to express something the panel
 * already knows.
 */
function AddToBoard({ d, widget, title, enabled }: { d: Dictionary; widget: string; title: string; enabled: boolean }) {
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!enabled) return null;

  return (
    <Button
      size="sm"
      variant="quiet"
      disabled={pending || done}
      onClick={() => startTransition(async () => setDone((await addServiceWidget(widget, title)).ok))}
    >
      {done ? d.settings.addedToBoard : d.settings.addToBoard}
    </Button>
  );
}

function Result({ result, d }: { result: ServiceResult | null; d: Dictionary }) {
  if (!result) return null;
  const jellyfinErrors: Record<string, string> = {
    "settings.jellyfinNoAnswer": d.settings.jellyfinNoAnswer,
    "settings.jellyfinKeyRejected": d.settings.jellyfinKeyRejected,
    "settings.jellyfinSessionsRejected": d.settings.jellyfinSessionsRejected,
    "settings.jellyfinAuthUnavailable": d.settings.jellyfinAuthUnavailable,
  };
  const error = result.error ? jellyfinErrors[result.error] ?? result.error : undefined;
  return result.ok ? (
    <span className="text-xs text-ok">✓ {d.common.ok}</span>
  ) : (
    <span className="truncate text-xs text-danger" title={error}>
      {error ?? d.common.failed}
    </span>
  );
}

function JellyfinForm({ d, value, onRemove }: { d: Dictionary; value: ServicesDisplay["jellyfin"]; onRemove: () => void }) {
  const [form, setForm] = useState({ url: value.url, localUrl: value.localUrl, appUrl: value.appUrl, cacheLocally: value.cacheLocally, apiKey: "" });
  const [result, setResult] = useState<ServiceResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader icon={serviceLogo("jellyfin")} iconFallback={SERVICE_ICONS.jellyfin} title="Jellyfin" action={<Badge tone={value.url || value.localUrl ? "ok" : "neutral"}>{value.url || value.localUrl ? "on" : "off"}</Badge>} />
      <div className="flex flex-col gap-3 p-4">
        <Field label={d.settings.jellyfinPublicUrl} hint={d.settings.jellyfinPublicUrlHint}>
          <Input
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            placeholder="http://192.168.0.10:8096"
            className="font-mono text-xs"
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={d.settings.jellyfinLocalUrl} hint={d.settings.jellyfinLocalUrlHint}>
            <Input
              value={form.localUrl}
              onChange={(e) => setForm({ ...form, localUrl: e.target.value })}
              placeholder="http://192.168.0.10:8096"
              className="font-mono text-xs"
            />
          </Field>
          <Field label={d.settings.jellyfinAppUrl} hint={d.settings.jellyfinAppUrlHint}>
            <Input
              value={form.appUrl}
              onChange={(e) => setForm({ ...form, appUrl: e.target.value })}
              placeholder="jellyfin://SERVER_ID/USER_ID/item/{id}"
              className="font-mono text-xs"
            />
          </Field>
        </div>
        <SecretField
          d={d}
          label="API key"
          hasSecret={value.hasKey}
          value={form.apiKey}
          onChange={(v) => setForm({ ...form, apiKey: v })}
          hint={d.settings.jellyfinKeyHint}
        />
        <label className="flex items-start gap-3 rounded-control border border-line bg-raised p-3 text-sm">
          <input type="checkbox" checked={form.cacheLocally} onChange={(e) => setForm({ ...form, cacheLocally: e.target.checked })} className="mt-0.5" />
          <span><span className="font-medium">{d.settings.mediaCache}</span><span className="mt-0.5 block text-xs text-muted">{d.settings.mediaCacheHint}</span></span>
        </label>
        <div className="flex items-center gap-3">
          <Button variant="primary" disabled={pending} onClick={() => startTransition(async () => setResult(await saveJellyfinSettings(form)))}>
            {d.common.save}
          </Button>
          <Result result={result} d={d} />
          <AddToBoard d={d} widget="jellyfin" title="Jellyfin" enabled={!!(value.url || value.localUrl)} />
          <Button variant="quiet" disabled={pending} onClick={() => startTransition(async () => { const next = await saveJellyfinSettings({ url: "", localUrl: "", appUrl: "", cacheLocally: false, apiKey: "" }); setResult(next); if (next.ok) onRemove(); })}>{d.common.delete}</Button>
        </div>
      </div>
    </Card>
  );
}

function OverseerrForm({ d, value, onRemove }: { d: Dictionary; value: ServicesDisplay["overseerr"]; onRemove: () => void }) {
  const [form, setForm] = useState({ url: value.url, apiKey: "" });
  const [result, setResult] = useState<ServiceResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader icon={serviceLogo("overseerr")} iconFallback={SERVICE_ICONS.overseerr} title="Overseerr" action={<Badge tone={value.url ? "ok" : "neutral"}>{value.url ? "on" : "off"}</Badge>} />
      <div className="flex flex-col gap-3 p-4">
        <Field label={d.settings.url} hint={d.settings.overseerrHint}>
          <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="http://192.168.0.10:5055" className="font-mono text-xs" />
        </Field>
        <SecretField d={d} label="API key" hasSecret={value.hasKey} value={form.apiKey} onChange={(apiKey) => setForm({ ...form, apiKey })} />
        <div className="flex items-center gap-3">
          <Button variant="primary" disabled={pending} onClick={() => startTransition(async () => setResult(await saveOverseerrSettings(form)))}>{d.common.save}</Button>
          <Result result={result} d={d} />
          <Button variant="quiet" disabled={pending} onClick={() => startTransition(async () => { const next = await saveOverseerrSettings({ url: "", apiKey: "" }); setResult(next); if (next.ok) onRemove(); })}>{d.common.delete}</Button>
        </div>
      </div>
    </Card>
  );
}

function QbitForm({ d, value, onRemove }: { d: Dictionary; value: ServicesDisplay["qbittorrent"]; onRemove: () => void }) {
  const [form, setForm] = useState({ url: value.url, username: value.username, password: "" });
  const [result, setResult] = useState<ServiceResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader icon={serviceLogo("qbittorrent")} iconFallback={SERVICE_ICONS.qbittorrent} title="qBittorrent" action={<Badge tone={value.url ? "ok" : "neutral"}>{value.url ? "on" : "off"}</Badge>} />
      <div className="flex flex-col gap-3 p-4">
        <Field label={d.settings.url}>
          <Input
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            placeholder="http://192.168.0.10:8080"
            className="font-mono text-xs"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={d.settings.username}>
            <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </Field>
          <SecretField
            d={d}
            label={d.settings.password}
            hasSecret={value.hasPassword}
            value={form.password}
            onChange={(v) => setForm({ ...form, password: v })}
          />
        </div>
        <div className="flex items-center gap-3">
          <Button variant="primary" disabled={pending} onClick={() => startTransition(async () => setResult(await saveQbitSettings(form)))}>
            {d.common.save}
          </Button>
          <Result result={result} d={d} />
          <AddToBoard d={d} widget="qbittorrent" title="qBittorrent" enabled={!!value.url} />
          <Button variant="quiet" disabled={pending} onClick={() => startTransition(async () => { const next = await saveQbitSettings({ url: "", username: "", password: "" }); setResult(next); if (next.ok) onRemove(); })}>{d.common.delete}</Button>
        </div>
      </div>
    </Card>
  );
}

/** Several *arr instances: they are the same API with different names. */
function ArrForm({ d, value, defaultKind, onRemove }: { d: Dictionary; value: ServicesDisplay["arr"]; defaultKind: string; onRemove: () => void }) {
  const [rows, setRows] = useState(
    value.length > 0
      ? value.map((a) => ({ kind: a.kind, label: a.label, url: a.url, apiKey: "" }))
      : [{ kind: defaultKind, label: defaultKind[0].toUpperCase() + defaultKind.slice(1), url: "", apiKey: "" }]
  );
  const [result, setResult] = useState<ServiceResult | null>(null);
  const [pending, startTransition] = useTransition();

  function update(i: number, patch: Partial<(typeof rows)[number]>) {
    setRows((prev) => prev.map((row, index) => (index === i ? { ...row, ...patch } : row)));
  }

  return (
    <Card>
      <CardHeader
        icon={serviceLogo(rows[0]?.kind ?? defaultKind)}
        iconFallback={SERVICE_ICONS[rows[0]?.kind ?? defaultKind]}
        title="Sonarr / Radarr / Lidarr"
        action={<Badge tone={value.length > 0 ? "ok" : "neutral"}>{value.length || "off"}</Badge>}
      />
      <div className="flex flex-col gap-3 p-4">
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 border-b border-line pb-3 last:border-0 last:pb-0">
            <Field label={d.settings.kind}>
              <Select value={row.kind} onChange={(e) => update(i, { kind: e.target.value, label: e.target.value })}>
                <option value="sonarr">Sonarr</option>
                <option value="radarr">Radarr</option>
                <option value="lidarr">Lidarr</option>
                <option value="readarr">Readarr</option>
              </Select>
            </Field>
            <Field label={d.dashboard.tileTitle}>
              <Input value={row.label} onChange={(e) => update(i, { label: e.target.value })} />
            </Field>
            <Field label={d.settings.url}>
              <Input
                value={row.url}
                onChange={(e) => update(i, { url: e.target.value })}
                placeholder="http://192.168.0.10:8989"
                className="font-mono text-xs"
              />
            </Field>
            <SecretField
              d={d}
              label="API key"
              hasSecret={!!value[i]?.hasKey}
              value={row.apiKey}
              onChange={(v) => update(i, { apiKey: v })}
            />
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setRows((prev) => [...prev, { kind: "radarr", label: "Radarr", url: "", apiKey: "" }])}>
            +
          </Button>
          <Button variant="primary" disabled={pending} onClick={() => startTransition(async () => setResult(await saveArrSettings(rows)))}>
            {d.common.save}
          </Button>
          <Result result={result} d={d} />
          <AddToBoard d={d} widget="arr" title="*arr" enabled={value.length > 0} />
          <Button variant="quiet" disabled={pending} onClick={() => startTransition(async () => { const next = await saveArrSettings([]); setResult(next); if (next.ok) onRemove(); })}>{d.common.delete}</Button>
        </div>
      </div>
    </Card>
  );
}

function PbsForm({ d, value, onRemove }: { d: Dictionary; value: ServicesDisplay["pbs"]; onRemove: () => void }) {
  const [form, setForm] = useState({
    url: value.url,
    tokenId: value.tokenId,
    tokenSecret: "",
    verifyTls: value.verifyTls,
  });
  const [result, setResult] = useState<ServiceResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader icon={serviceLogo("pbs")} iconFallback={SERVICE_ICONS.pbs} title="Proxmox Backup Server" action={<Badge tone={value.url ? "ok" : "neutral"}>{value.url ? "on" : "off"}</Badge>} />
      <div className="flex flex-col gap-3 p-4">
        <Field label={d.settings.url}>
          <Input
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            placeholder="https://192.168.0.11:8007"
            className="font-mono text-xs"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={d.settings.tokenId}>
            <Input
              value={form.tokenId}
              onChange={(e) => setForm({ ...form, tokenId: e.target.value })}
              placeholder="root@pam!homeplace"
              className="font-mono text-xs"
            />
          </Field>
          <SecretField
            d={d}
            label={d.settings.tokenSecret}
            hasSecret={value.hasSecret}
            value={form.tokenSecret}
            onChange={(v) => setForm({ ...form, tokenSecret: v })}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={form.verifyTls} onChange={(e) => setForm({ ...form, verifyTls: e.target.checked })} />
          {d.settings.verifyTls}
        </label>
        <div className="flex items-center gap-3">
          <Button variant="primary" disabled={pending} onClick={() => startTransition(async () => setResult(await savePbsSettings(form)))}>
            {d.common.save}
          </Button>
          <Result result={result} d={d} />
          <AddToBoard d={d} widget="pbs" title="Proxmox Backup" enabled={!!value.url} />
          <Button variant="quiet" disabled={pending} onClick={() => startTransition(async () => { const next = await savePbsSettings({ url: "", tokenId: "", tokenSecret: "", verifyTls: true }); setResult(next); if (next.ok) onRemove(); })}>{d.common.delete}</Button>
        </div>
      </div>
    </Card>
  );
}

function HaForm({ d, value, onRemove }: { d: Dictionary; value: ServicesDisplay["homeassistant"]; onRemove: () => void }) {
  const [form, setForm] = useState({ url: value.url, token: "" });
  const [result, setResult] = useState<ServiceResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader icon={serviceLogo("homeassistant")} iconFallback={SERVICE_ICONS.homeassistant} title="Home Assistant" action={<Badge tone={value.url ? "ok" : "neutral"}>{value.url ? "on" : "off"}</Badge>} />
      <div className="flex flex-col gap-3 p-4">
        <Field label={d.settings.url}>
          <Input
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            placeholder="http://192.168.0.12:8123"
            className="font-mono text-xs"
          />
        </Field>
        <SecretField
          d={d}
          label={d.settings.haToken}
          hasSecret={value.hasToken}
          value={form.token}
          onChange={(v) => setForm({ ...form, token: v })}
          hint={d.settings.haTokenHint}
        />
        <div className="flex items-center gap-3">
          <Button variant="primary" disabled={pending} onClick={() => startTransition(async () => setResult(await saveHaSettings(form)))}>
            {d.common.save}
          </Button>
          <Result result={result} d={d} />
          <AddToBoard d={d} widget="homeassistant" title="Home Assistant" enabled={!!value.url} />
          <Button variant="quiet" disabled={pending} onClick={() => startTransition(async () => { const next = await saveHaSettings({ url: "", token: "" }); setResult(next); if (next.ok) onRemove(); })}>{d.common.delete}</Button>
        </div>
      </div>
    </Card>
  );
}
