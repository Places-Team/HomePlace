"use client";

import { useState, useTransition } from "react";
import { Card, CardHeader, Badge } from "@/components/ui";
import { Field, Input, Select, Button } from "@/components/form";
import {
  savePrometheusSettings,
  saveProxmoxSettings,
  saveTelegramSettings,
  saveTelegramBotMonitorSettings,
  testTelegram,
  setTelegramCommands,
  rotateNowPlayingToken,
  disableNowPlaying,
  setIconPack,
  saveGoogleSettings,
  unlinkGoogle,
  saveFatSecretSettings,
  type TestResult,
} from "@/actions/integrations";
import { importConfig } from "@/actions/config";
import { SecretField } from "./SecretField";
import type { Dictionary } from "@/i18n";

/**
 * Configuring the integrations from the browser.
 *
 * Anything already pinned in .env is shown as fixed rather than as an editable
 * field: a deployment that hard-codes an address means it, and a form that
 * silently did nothing would be worse than no form.
 *
 * Every save runs a real request against the thing being configured, and the
 * result is what appears next to the button — "saved" alone would be answering
 * a question nobody asked.
 */

type Display = {
  prometheus: { url: string; username: string; hasPassword: boolean; source: string };
  proxmox: { url: string; tokenId: string; hasSecret: boolean; verifyTls: boolean; source: string };
  google: { clientId: string; hasSecret: boolean; source: string; linkedEmail: string | null; redirectUri: string };
  telegram: {
    enabled: boolean;
    chatId: string;
    hasToken: boolean;
    delaySeconds: number;
    notifyRecovery: boolean;
    quietHours: string;
    proxyUrl: string;
    source: string;
    commands: boolean;
  };
  telegramBots: { id: string; label: string; enabled: boolean; hasToken: boolean; proxyUrl: string }[];
  fatsecret: { clientId: string; hasSecret: boolean };
};

export function IntegrationForms({
  d,
  display,
  nowPlayingToken,
  appUrl,
  iconPack,
  only,
}: {
  d: Dictionary;
  display: Display;
  nowPlayingToken: string;
  appUrl: string;
  iconPack: boolean;
  /**
   * Which half to render. The settings page is split into sections, and these
   * cards belong to two different ones: the connections to other machines, and
   * the things that are about this installation itself.
   */
  only?: "connections" | "system";
}) {
  if (only === "system") {
    return (
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <NowPlayingCard d={d} token={nowPlayingToken} appUrl={appUrl} />
        <IconsCard d={d} enabled={iconPack} />
        <ConfigCard d={d} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      <PrometheusForm d={d} value={display.prometheus} />
      <ProxmoxForm d={d} value={display.proxmox} />
      <TelegramForm d={d} value={display.telegram} />
      <TelegramBotMonitorForm d={d} value={display.telegramBots} />
      <GoogleCard d={d} value={display.google} />
      <FatSecretForm d={d} value={display.fatsecret} />
    </div>
  );
}

// ─────────────────────────────── FatSecret ───────────────────────────────

function FatSecretForm({ d, value }: { d: Dictionary; value: Display["fatsecret"] }) {
  const [form, setForm] = useState({ clientId: value.clientId, secret: "" });
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader
        title={d.settings.integrationFatSecret}
        action={<Badge tone={value.clientId ? "ok" : "neutral"}>{value.clientId ? d.common.ok : "none"}</Badge>}
      />
      <div className="space-y-3 p-4">
        <p className="text-xs text-muted">{d.settings.fatSecretHint}</p>
        <Field label={d.settings.fatSecretClientId}>
          <Input value={form.clientId} onChange={(e) => { setForm({ ...form, clientId: e.target.value }); setSaved(false); }} />
        </Field>
        <SecretField
          d={d}
          label={d.settings.fatSecretSecret}
          hasSecret={value.hasSecret}
          value={form.secret}
          onChange={(v) => { setForm({ ...form, secret: v }); setSaved(false); }}
        />
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await saveFatSecretSettings(form);
                setForm({ ...form, secret: "" });
                setSaved(true);
              })
            }
          >
            {d.common.save}
          </Button>
          {saved && <span className="text-xs text-ok">✓ {d.common.ok}</span>}
        </div>
      </div>
    </Card>
  );
}

/** Shown in place of the form when the values come from the environment. */
function EnvNotice({ d, lines }: { d: Dictionary; lines: string[] }) {
  return (
    <div className="p-4">
      <Badge tone="accent">{d.settings.managedInEnv}</Badge>
      <ul className="mt-2 space-y-0.5">
        {lines.map((line) => (
          <li key={line} className="truncate font-mono text-xs text-muted">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Result({ result, d }: { result: TestResult | null; d: Dictionary }) {
  if (!result) return null;
  return result.ok ? (
    <span className="text-xs text-ok">✓ {d.common.ok}</span>
  ) : (
    <span className="truncate text-xs text-danger" title={result.error}>
      {result.error ?? d.common.failed}
    </span>
  );
}

// ─────────────────────────────── Prometheus ──────────────────────────────

function PrometheusForm({ d, value }: { d: Dictionary; value: Display["prometheus"] }) {
  const [form, setForm] = useState({ url: value.url, username: value.username, password: "" });
  const [result, setResult] = useState<TestResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader
        title={d.settings.integrationPrometheus}
        action={<Badge tone={value.source === "none" ? "neutral" : "ok"}>{value.source}</Badge>}
      />
      {value.source === "env" ? (
        <EnvNotice d={d} lines={[value.url]} />
      ) : (
        <div className="flex flex-col gap-3 p-4">
          <Field label={d.settings.url}>
            <Input
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="http://192.168.0.10:9090"
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
            <Button
              variant="primary"
              disabled={pending}
              onClick={() => startTransition(async () => setResult(await savePrometheusSettings(form)))}
            >
              {d.common.save}
            </Button>
            <Result result={result} d={d} />
          </div>
        </div>
      )}
    </Card>
  );
}

// ───────────────────────────────── Proxmox ───────────────────────────────

function ProxmoxForm({ d, value }: { d: Dictionary; value: Display["proxmox"] }) {
  const [form, setForm] = useState({
    url: value.url,
    tokenId: value.tokenId,
    tokenSecret: "",
    verifyTls: value.verifyTls,
  });
  const [result, setResult] = useState<TestResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader
        title={d.settings.integrationProxmox}
        action={<Badge tone={value.source === "none" ? "neutral" : "ok"}>{value.source}</Badge>}
      />
      {value.source === "env" ? (
        <EnvNotice d={d} lines={[value.url, value.tokenId]} />
      ) : (
        <div className="flex flex-col gap-3 p-4">
          <Field label={d.settings.url}>
            <Input
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://192.168.0.5:8006"
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
            <input
              type="checkbox"
              checked={form.verifyTls}
              onChange={(e) => setForm({ ...form, verifyTls: e.target.checked })}
            />
            {d.settings.verifyTls}
          </label>
          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              disabled={pending}
              onClick={() => startTransition(async () => setResult(await saveProxmoxSettings(form)))}
            >
              {d.common.save}
            </Button>
            <Result result={result} d={d} />
          </div>
        </div>
      )}
    </Card>
  );
}

// ──────────────────────────────── Telegram ───────────────────────────────

/** Split a stored proxy URL into a type and an address for the two controls. */
function parseProxy(url: string): { type: string; addr: string } {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return { type: "none", addr: "" };
  const m = /^(socks5h?|socks|https?):\/\/(.*)$/i.exec(trimmed);
  if (m) {
    const scheme = m[1].toLowerCase();
    return { type: scheme.startsWith("socks") ? "socks5" : scheme, addr: m[2] };
  }
  // A bare "host:port" from before the scheme was explicit — assume SOCKS5.
  return { type: "socks5", addr: trimmed };
}

function TelegramForm({ d, value }: { d: Dictionary; value: Display["telegram"] }) {
  const [form, setForm] = useState({
    enabled: value.enabled,
    botToken: "",
    chatId: value.chatId,
    delaySeconds: value.delaySeconds,
    notifyRecovery: value.notifyRecovery,
    quietHours: value.quietHours,
    proxyUrl: value.proxyUrl,
    commands: value.commands,
  });
  const [result, setResult] = useState<TestResult | null>(null);
  const [pending, startTransition] = useTransition();

  // The proxy is stored as one URL ("socks5://host:port") but edited as a type
  // and an address, so the choice of protocol is a menu rather than something to
  // remember how to spell. MTProto is deliberately absent: it cannot carry the
  // Bot API's HTTPS, only SOCKS5 and HTTP can.
  const initialProxy = parseProxy(value.proxyUrl);
  const [proxyType, setProxyType] = useState(initialProxy.type);
  const [proxyAddr, setProxyAddr] = useState(initialProxy.addr);
  function updateProxy(type: string, addr: string) {
    setProxyType(type);
    setProxyAddr(addr);
    setForm((f) => ({ ...f, proxyUrl: type === "none" || !addr.trim() ? "" : `${type}://${addr.trim()}` }));
  }

  return (
    <Card>
      <CardHeader
        title="Telegram"
        action={<Badge tone={value.source === "none" ? "neutral" : value.enabled ? "ok" : "neutral"}>{value.source}</Badge>}
      />
      {value.source === "env" ? (
        <EnvNotice d={d} lines={["TELEGRAM_BOT_TOKEN", `chat ${value.chatId}`]} />
      ) : (
        <div className="flex flex-col gap-3 p-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            {d.common.enabled}
          </label>

          <div className="grid grid-cols-2 gap-3">
            <SecretField
              d={d}
              label={d.settings.telegramBotToken}
              hasSecret={value.hasToken}
              value={form.botToken}
              onChange={(v) => setForm({ ...form, botToken: v })}
              placeholder="123456:ABC…"
            />
            <Field label={d.settings.telegramChatId}>
              <Input
                value={form.chatId}
                onChange={(e) => setForm({ ...form, chatId: e.target.value })}
                className="font-mono text-xs"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={`${d.settings.telegramDelay}, ${d.dashboard.seconds}`}>
              <Input
                type="number"
                min={0}
                value={form.delaySeconds}
                onChange={(e) => setForm({ ...form, delaySeconds: Number(e.target.value) })}
              />
            </Field>
            <Field label={d.settings.telegramQuiet} hint={d.settings.telegramQuietHint}>
              <Input
                value={form.quietHours}
                onChange={(e) => setForm({ ...form, quietHours: e.target.value })}
                placeholder="23:00-08:00"
                className="font-mono text-xs"
              />
            </Field>
          </div>

          <Field label={d.settings.telegramProxy} hint={d.settings.telegramProxyHint}>
            <div className="space-y-2">
              <Select value={proxyType} onChange={(e) => updateProxy(e.target.value, proxyAddr)} className="w-full">
                <option value="none">{d.common.none}</option>
                <option value="socks5">SOCKS5</option>
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
              </Select>
              {proxyType !== "none" && (
                <Input
                  value={proxyAddr}
                  onChange={(e) => updateProxy(proxyType, e.target.value)}
                  placeholder="user:pass@192.168.0.10:10808"
                  className="w-full font-mono text-xs"
                />
              )}
            </div>
          </Field>

          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={form.notifyRecovery}
              onChange={(e) => setForm({ ...form, notifyRecovery: e.target.checked })}
            />
            {d.settings.telegramRecovery}
          </label>

          {/* Independent of Save: the bot poll reads this setting directly, so
              flipping it takes effect on the next tick without a save. */}
          <label className="flex items-start gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={form.commands}
              disabled={pending}
              onChange={(e) => {
                setForm({ ...form, commands: e.target.checked });
                startTransition(() => void setTelegramCommands(e.target.checked));
              }}
            />
            <span>
              {d.settings.telegramCommands}
              <span className="block text-[11px] text-faint">{d.settings.telegramCommandsHint}</span>
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              disabled={pending}
              onClick={() => startTransition(async () => setResult(await saveTelegramSettings(form)))}
            >
              {d.common.save}
            </Button>
            <Button
              disabled={pending}
              // Saves first, then sends: testing the values still in the boxes
              // is what someone means by "test", not testing what was stored
              // before they started typing.
              onClick={() =>
                startTransition(async () => {
                  await saveTelegramSettings(form);
                  setResult(await testTelegram());
                })
              }
            >
              {d.settings.telegramTest}
            </Button>
            <Result result={result} d={d} />
          </div>
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────── Now playing ─────────────────────────────

function TelegramBotMonitorForm({ d, value }: { d: Dictionary; value: Display["telegramBots"] }) {
  const [rows, setRows] = useState(() => value.map((bot) => ({ ...bot, botToken: "" })));
  const [result, setResult] = useState<TestResult | null>(null);
  const [pending, startTransition] = useTransition();

  function update(index: number, patch: Partial<(typeof rows)[number]>) {
    setResult(null);
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  function add() {
    setRows((current) => [
      ...current,
      { id: `bot-${Date.now().toString(36)}`, label: "", enabled: true, hasToken: false, botToken: "", proxyUrl: "" },
    ]);
  }

  function save() {
    startTransition(async () => {
      const saved = await saveTelegramBotMonitorSettings(rows.map(({ hasToken: _hasToken, ...row }) => row));
      setResult(saved);
      if (saved.ok) setRows((current) => current.map((row) => ({ ...row, botToken: "", hasToken: true })));
    });
  }

  return (
    <Card>
      <CardHeader title={d.settings.telegramMonitors} action={<Badge tone={rows.length > 0 ? "ok" : "neutral"}>{rows.length}</Badge>} />
      <div className="space-y-3 p-4">
        <p className="text-sm text-muted">{d.settings.telegramMonitorsHint}</p>
        {rows.map((row, index) => (
          <div key={row.id} className="space-y-2 rounded-control border border-line p-3">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={row.enabled}
                onChange={(event) => update(index, { enabled: event.target.checked })}
                aria-label={d.common.enabled}
              />
              <Input
                value={row.label}
                onChange={(event) => update(index, { label: event.target.value })}
                placeholder={d.settings.telegramMonitorName}
                className="flex-1"
              />
              <Button variant="quiet" onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} title={d.common.delete}>
                ×
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <SecretField
                d={d}
                label={d.settings.telegramBotToken}
                hasSecret={row.hasToken}
                value={row.botToken}
                onChange={(botToken) => update(index, { botToken })}
                placeholder="123456:ABC…"
              />
              <Field label={d.settings.telegramProxy} hint={d.common.optional}>
                <Input
                  value={row.proxyUrl}
                  onChange={(event) => update(index, { proxyUrl: event.target.value })}
                  placeholder="socks5://192.168.0.10:1080"
                  className="font-mono text-xs"
                />
              </Field>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" onClick={add}>＋ {d.settings.telegramMonitorAdd}</Button>
          <div className="flex items-center gap-2">
            <Result result={result} d={d} />
            <Button variant="primary" disabled={pending} onClick={save}>{d.settings.telegramMonitorSave}</Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function NowPlayingCard({ d, token, appUrl }: { d: Dictionary; token: string; appUrl: string }) {
  const [current, setCurrent] = useState(token);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const example = `curl -X POST ${appUrl}/api/now-playing \\
  -H "authorization: Bearer ${current || "<token>"}" \\
  -H "content-type: application/json" \\
  -d '{"title":"Song","artist":"Band","art":"https://…/cover.jpg"}'`;

  return (
    <Card>
      <CardHeader title={d.settings.nowPlaying} action={<Badge tone={current ? "ok" : "neutral"}>{current ? "on" : "off"}</Badge>} />
      <div className="flex flex-col gap-3 p-4">
        <p className="text-xs text-muted">{d.settings.nowPlayingHint}</p>

        {current && (
          <>
            <Field label={d.settings.token}>
              <Input readOnly value={current} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            </Field>
            <pre className="overflow-x-auto rounded-control bg-raised p-3 font-mono text-[10px] leading-relaxed text-muted">
              {example}
            </pre>
          </>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={pending}
            onClick={() => startTransition(async () => setCurrent(await rotateNowPlayingToken()))}
          >
            {current ? d.settings.rotate : d.common.generate}
          </Button>
          {current && (
            <>
              <Button
                disabled={pending}
                onClick={async () => {
                  await navigator.clipboard.writeText(current);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? d.common.copied : d.common.copy}
              </Button>
              <Button
                variant="danger"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await disableNowPlaying();
                    setCurrent("");
                  })
                }
              >
                {d.settings.turnOff}
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

// ───────────────────────────────── Google ────────────────────────────────

/**
 * Linking a Google account for the calendar widget.
 *
 * Two steps, and they are separate on purpose: the panel's owner registers an
 * OAuth client once, and then each person links their own calendar. The
 * redirect URI is shown to be copied into the Google console — getting it
 * slightly wrong is the single most common reason this refuses to work.
 */
function GoogleCard({ d, value }: { d: Dictionary; value: Display["google"] }) {
  const [form, setForm] = useState({ clientId: value.clientId, clientSecret: "" });
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader
        title="Google"
        action={<Badge tone={value.linkedEmail ? "ok" : value.source === "none" ? "neutral" : "accent"}>{value.linkedEmail ? "linked" : value.source}</Badge>}
      />
      <div className="flex flex-col gap-3 p-4">
        <p className="text-xs text-muted">{d.settings.googleHint}</p>

        <Field label={d.settings.googleRedirect}>
          <Input readOnly value={value.redirectUri} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        </Field>

        {value.source === "env" ? (
          <EnvNotice d={d} lines={["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Client ID">
                <Input
                  value={form.clientId}
                  onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                  className="font-mono text-xs"
                />
              </Field>
              <SecretField
                d={d}
                label="Client secret"
                hasSecret={value.hasSecret}
                value={form.clientSecret}
                onChange={(v) => setForm({ ...form, clientSecret: v })}
              />
            </div>
            <div>
              <Button
                variant="primary"
                disabled={pending}
                onClick={() => startTransition(async () => void (await saveGoogleSettings(form)))}
              >
                {d.common.save}
              </Button>
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {value.linkedEmail ? (
            <>
              <span className="text-xs text-muted">{value.linkedEmail}</span>
              <Button variant="danger" disabled={pending} onClick={() => startTransition(() => void unlinkGoogle())}>
                {d.settings.googleUnlink}
              </Button>
            </>
          ) : (
            <a
              href="/api/auth/google/start"
              className={`inline-flex items-center rounded-control border border-line bg-surface px-3.5 py-2 text-sm font-medium transition-colors hover:bg-raised ${
                value.source === "none" && !value.clientId ? "pointer-events-none opacity-50" : ""
              }`}
            >
              {d.settings.googleLink}
            </a>
          )}
        </div>
      </div>
    </Card>
  );
}

// ───────────────────────────────── Icons ─────────────────────────────────

function IconsCard({ d, enabled }: { d: Dictionary; enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader title={d.settings.icons} action={<Badge tone={on ? "ok" : "neutral"}>{on ? "on" : "off"}</Badge>} />
      <div className="flex flex-col gap-2 p-4">
        <p className="text-xs text-muted">{d.settings.iconsHint}</p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={on}
            disabled={pending}
            onChange={(e) => {
              const next = e.target.checked;
              setOn(next);
              startTransition(() => void setIconPack(next));
            }}
          />
          {d.settings.iconsPack}
        </label>
      </div>
    </Card>
  );
}

// ────────────────────────── Export and import ────────────────────────────

function ConfigCard({ d }: { d: Dictionary }) {
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFile(file: File) {
    const text = await file.text();
    // Replacing wipes every dashboard first — worth one question, since the
    // file being imported might not contain what the person assumes.
    if (mode === "replace" && !confirm(d.settings.importReplace + "?")) return;
    startTransition(async () => {
      const result = await importConfig(text, mode);
      setMessage(
        result.ok ? `${d.settings.importDone}: ${result.dashboards} / ${result.items}` : result.error ?? d.common.error
      );
    });
  }

  return (
    <Card>
      <CardHeader title={d.settings.configuration} />
      <div className="flex flex-col gap-3 p-4">
        <p className="text-xs text-muted">{d.settings.exportHint}</p>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/api/config/export"
            className="inline-flex items-center rounded-control border border-line bg-surface px-3.5 py-2 text-sm font-medium transition-colors hover:bg-raised"
          >
            {d.settings.exportConfig}
          </a>

          <Select value={mode} onChange={(e) => setMode(e.target.value as "merge" | "replace")} className="max-w-[12rem]">
            <option value="merge">{d.settings.importMerge}</option>
            <option value="replace">{d.settings.importReplace}</option>
          </Select>

          <label className="inline-flex cursor-pointer items-center rounded-control border border-line bg-surface px-3.5 py-2 text-sm font-medium transition-colors hover:bg-raised">
            {d.settings.importConfig}
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              disabled={pending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>

        {message && <p className="text-xs text-muted">{message}</p>}
      </div>
    </Card>
  );
}
