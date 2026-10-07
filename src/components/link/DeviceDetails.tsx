"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateDeviceQuickSharing, updateDeviceClipboardRelay, updateDeviceIdeasAccess, updateDevicePlantsAccess,
  updateDeviceHouseholdSharing, sendDeviceTestNotification, revokeDevice } from "@/actions/linkDevices";
import { DeviceActions } from "@/app/(app)/devices/DeviceActions";
import { Dialog } from "@/components/Dialog";
import { Button } from "@/components/form";
import { CAPABILITY_LABELS, DEVICE_PERMISSION_GROUPS, PLATFORM_NAMES, type DeviceView } from "@/lib/deviceWorkspace";
import type { Dictionary } from "@/i18n";
import { DeviceLogo, useDeviceTimeZone } from "./DeviceIdentity";
import styles from "./DevicesWorkspace.module.css";

type Labels = Pick<Dictionary, "devices" | "common">;
const edits: Record<string, (id: string, enabled: boolean) => Promise<boolean>> = {
  "share.relay": updateDeviceQuickSharing, "clipboard.relay": updateDeviceClipboardRelay,
  "ideas.manage": updateDeviceIdeasAccess, "plants.manage": updateDevicePlantsAccess, household: updateDeviceHouseholdSharing,
};

export function DeviceDetails({ device, d, ru }: { device: DeviceView; d: Labels; ru: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [confirm, setConfirm] = useState<{ key: string; label: string; hint: string } | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [tab, setTab] = useState<"overview" | "access">("overview");
  const timeZone = useDeviceTimeZone();
  const say = (en: string, russian: string) => ru ? russian : en;
  const date = (value: string | null) => value ? new Date(value).toLocaleString(ru ? "ru-RU" : "en-US", { dateStyle: "medium", timeStyle: "short", timeZone }) : d.devices.neverConnected;
  const has = (capability: string) => device.capabilities.includes(capability);

  function change(key: string, enabled: boolean) {
    setConfirm(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const changed = await edits[key](device.id, enabled);
        setNotice({ error: !changed, text: changed ? say("Access updated.", "Доступ обновлён.") : say("Could not update access. Refresh the device and try again.", "Не удалось изменить доступ. Обновите устройство и попробуйте снова.") });
        router.refresh();
      } catch { setNotice({ error: true, text: say("Could not save changes.", "Не удалось сохранить изменения.") }); }
    });
  }

  return <aside aria-label={say("Device details", "Сведения об устройстве")} className="rounded-card border border-line bg-surface">
    <header className="border-b border-line p-5">
      <div className="flex items-start gap-3"><DeviceLogo platform={device.platform} className="h-14 w-14" />
        <div className="min-w-0"><h2 className="break-words text-lg font-semibold tracking-tight">{device.name}</h2>
          <p className="mt-1 text-sm text-muted">{PLATFORM_NAMES[device.platform] ?? device.platform} {device.platformVersion}</p>
          <span className={`mt-2 inline-flex items-center gap-1.5 text-xs font-medium ${device.online ? "text-ok" : "text-muted"}`}><span className={`h-1.5 w-1.5 rounded-full ${device.online ? "bg-ok" : "bg-muted"}`} />{device.online ? d.devices.online : d.devices.offline}</span>
        </div>
      </div>
      <dl className="mt-5 space-y-2 text-sm">
        <div className="flex justify-between gap-3"><dt className="text-muted">{d.devices.owner}</dt><dd className="text-right font-medium">{device.ownerName ?? d.devices.unassigned}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted">{say("App version", "Версия приложения")}</dt><dd className="font-mono text-xs">{device.appVersion || "—"}</dd></div>
        <div><dt className="text-xs text-muted">{d.devices.lastSeen}</dt><dd className="mt-1 text-sm"><time dateTime={device.lastSeenAt ?? undefined}>{date(device.lastSeenAt)}</time></dd></div>
      </dl>
      <div className="mt-5 space-y-2">
        <DeviceActions id={device.id} canNotify={has("notification.receive")} canOpenUrl={has("url.open")} canReceiveText={has("text.receive")}
          canReceiveFile={has("file.receive")} allowHouseholdShares={device.allowHouseholdShares} quickSharingEnabled={device.permissions.includes("share.relay")} compact d={d} />
        {has("notification.receive") && <Button size="sm" disabled={pending} onClick={() => {
          setNotice(null);
          startTransition(async () => {
            try {
              const queued = await sendDeviceTestNotification(device.id);
              setNotice({ error: !queued, text: queued
                ? say("Test notification queued. An offline device will receive it when it reconnects.", "Тестовое уведомление поставлено в очередь. Устройство вне сети получит его после подключения.")
                : say("This device cannot receive notifications right now.", "Сейчас устройство не может принять уведомление.") });
            } catch { setNotice({ error: true, text: say("Could not queue the notification.", "Не удалось отправить уведомление в очередь.") }); }
          });
        }}>{d.devices.testNotification}</Button>}
      </div>
      {notice && <p role={notice.error ? "alert" : "status"} className={`mt-3 text-sm leading-relaxed ${notice.error ? "text-danger" : "text-muted"}`}>{notice.text}</p>}
    </header>
    <div className="flex gap-1 border-b border-line px-5 py-2" aria-label={say("Device panel view", "Раздел панели устройства")}>
      <button type="button" aria-pressed={tab === "overview"} onClick={() => setTab("overview")} className={`rounded-control px-3 py-2 text-sm font-medium ${tab === "overview" ? "bg-raised text-text" : "text-muted hover:text-text"}`}>{say("Overview", "Сведения")}</button>
      <button type="button" aria-pressed={tab === "access"} onClick={() => setTab("access")} className={`rounded-control px-3 py-2 text-sm font-medium ${tab === "access" ? "bg-raised text-text" : "text-muted hover:text-text"}`}>{say("Access", "Доступ")} <span className="ml-1 text-xs tabular-nums text-muted">{device.permissions.length}</span></button>
    </div>
    <div className="space-y-5 p-5">
      {tab === "overview" && <section><h3 className="text-sm font-semibold">{say("Available on this device", "Доступно на устройстве")}</h3>
        <div className="mt-3 flex flex-wrap gap-2">{device.capabilities.map(capability => <span key={capability} className="rounded-md bg-raised px-2.5 py-1.5 text-xs text-muted">{CAPABILITY_LABELS[capability]?.[ru ? 0 : 1] ?? capability}</span>)}</div>
        {!device.capabilities.length && <p className="mt-2 text-sm text-muted">{say("No approved active capabilities reported.", "Нет активных подтверждённых возможностей.")}</p>}
        <p className="mt-4 text-xs text-muted">{say("Connected", "Подключено")}: {date(device.createdAt)}</p>
        <p className="mt-3 text-xs leading-relaxed text-muted">{say("The account controls personal data. Open Access to review sharing and sync permissions.", "Личные данные привязаны к аккаунту. В разделе «Доступ» можно настроить обмен и синхронизацию.")}</p>
      </section>}
      {tab === "access" && <>
      <div><h3 className="text-sm font-semibold">{say("Access permissions", "Права доступа")}</h3><p className="mt-1 text-xs leading-relaxed text-muted">{say("Permissions control which account data this device can use. They do not change its system capabilities.", "Права определяют доступ к данным аккаунта. Они не меняют системные возможности устройства.")}</p></div>
      {DEVICE_PERMISSION_GROUPS.map(group => {
        const rows = group.permissions.filter(permission => permission.editable || device.permissions.includes(permission.key));
        if (!rows.length) return null;
        return <section key={group.id} aria-label={ru ? group.ru : group.en}>
          <h4 className="mb-2 text-xs font-semibold text-muted">{ru ? group.ru : group.en}</h4>
          <div className="divide-y divide-line">{rows.map(permission => {
            const enabled = device.permissions.includes(permission.key);
            const label = ru ? permission.ru : permission.en;
            const hint = ru ? permission.hintRu : permission.hintEn;
            return <div key={permission.key} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0"><p className="text-sm font-medium">{label}</p><p className="mt-1 text-xs leading-relaxed text-muted">{hint}</p></div>
              {permission.editable ? <button type="button" role="switch" aria-checked={enabled} aria-label={label}
                disabled={pending || (!device.ownerId && permission.key !== "share.relay")} className={styles.permissionSwitch}
                onClick={() => enabled ? change(permission.key, false) : setConfirm({ key: permission.key, label, hint })}><span /></button>
                : <span className="shrink-0 pt-0.5 text-xs text-muted">{say("Paired", "При подключении")}</span>}
            </div>;
          })}</div>
        </section>;
      })}
      {!device.ownerId && <p className="text-xs text-warn">{say("Personal data access requires an account binding.", "Для доступа к личным данным нужна привязка к аккаунту.")}</p>}
      <section className="border-t border-line pt-4">
        <div className="flex items-start justify-between gap-3">
          <div><h4 className="text-sm font-medium">{say("Receive from other accounts", "Принимать от других аккаунтов")}</h4>
            <p className="mt-1 text-xs leading-relaxed text-muted">{say("Other HomePlace users can send content here. Clipboard sync stays within its owner's account.", "Другие пользователи HomePlace смогут отправлять сюда материалы. Буфер остаётся внутри аккаунта владельца.")}</p>
          </div>
          <button type="button" role="switch" aria-checked={device.allowHouseholdShares} aria-label={say("Receive from other accounts", "Принимать от других аккаунтов")}
            className={styles.permissionSwitch} disabled={pending} onClick={() => device.allowHouseholdShares ? change("household", false)
              : setConfirm({ key: "household", label: say("Receive from other accounts", "Принимать от других аккаунтов"), hint: say("Other accounts on this HomePlace server will be able to send text, links and files to this device.", "Другие аккаунты этого сервера HomePlace смогут отправлять на устройство текст, ссылки и файлы.") })}><span /></button>
        </div>
      </section>
      </>}
      <details className="border-t border-line pt-4">
        <summary className="cursor-pointer text-sm font-medium text-muted">{say("Technical details", "Технические подробности")}</summary>
        <div className="mt-3 space-y-3 text-xs text-muted"><p>{say("Connected", "Подключено")}: {date(device.createdAt)}</p>
          <p className="break-all font-mono">ID: {device.id}</p>
          <p>{say("Active approved capabilities", "Активные подтверждённые возможности")}</p>
          <ul className="space-y-1">{device.capabilities.map(capability => <li key={capability} className="flex flex-wrap justify-between gap-2"><span>{CAPABILITY_LABELS[capability]?.[ru ? 0 : 1] ?? capability}</span><code className="break-all">{capability}</code></li>)}</ul>
          {!device.capabilities.length && <p>{say("No approved active capabilities reported.", "Нет активных подтверждённых возможностей.")}</p>}
          <p>{say("Permission codes", "Коды прав")}: <code className="break-all">{device.permissions.join(", ") || "—"}</code></p>
          <p>{say("Permissions marked “Paired” were granted during pairing; this panel does not expand them.", "Права «При подключении» были выданы при привязке; эта панель не расширяет их.")}</p>
        </div>
      </details>
      <div className="border-t border-line pt-4"><Button variant="danger" size="sm" disabled={pending} onClick={() => setRevokeOpen(true)}>{d.devices.revoke}</Button></div>
    </div>
    <Dialog open={confirm !== null} onClose={() => setConfirm(null)} title={confirm?.label ?? ""}>
      <p className="text-sm leading-relaxed text-muted">{confirm?.hint}</p><p className="mt-3 text-sm">{say(`Allow “${device.name}” this access?`, `Разрешить устройству «${device.name}» этот доступ?`)}</p>
      <div className="mt-5 flex justify-end gap-2"><Button onClick={() => setConfirm(null)}>{d.common.cancel}</Button><Button variant="primary" onClick={() => { if (confirm) change(confirm.key, true); }}>{say("Allow", "Разрешить")}</Button></div>
    </Dialog>
    <Dialog open={revokeOpen} onClose={() => setRevokeOpen(false)} title={d.devices.revoke}>
      <p className="text-sm leading-relaxed text-muted">{d.devices.revokeConfirm}</p>
      <div className="mt-5 flex justify-end gap-2"><Button onClick={() => setRevokeOpen(false)}>{d.common.cancel}</Button><Button variant="danger" disabled={pending} onClick={() => {
        startTransition(async () => { try { await revokeDevice(device.id); setRevokeOpen(false); router.refresh(); }
          catch { setRevokeOpen(false); setNotice({ error: true, text: say("Could not disconnect this device.", "Не удалось отключить устройство.") }); } });
      }}>{d.devices.revoke}</Button></div>
    </Dialog>
  </aside>;
}
