"use client";

import { useState, useTransition } from "react";
import {
  approvePairing,
  rejectPairing,
  revokeDevice,
  sendDeviceShare,
  sendDeviceTestNotification,
} from "@/actions/linkDevices";
import { Dialog } from "@/components/Dialog";
import { Button, Field, Input, Select, Textarea } from "@/components/form";
import type { Dictionary } from "@/i18n";

export function PairingActions({ id, d }: { id: string; d: Dictionary }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex gap-2">
      <Button variant="primary" disabled={pending} onClick={() => startTransition(() => approvePairing(id))}>
        {d.devices.approve}
      </Button>
      <Button disabled={pending} onClick={() => startTransition(() => rejectPairing(id))}>
        {d.devices.reject}
      </Button>
    </div>
  );
}

export function DeviceActions({
  id,
  canNotify,
  canOpenUrl,
  canReceiveText,
  d,
}: {
  id: string;
  canNotify: boolean;
  canOpenUrl: boolean;
  canReceiveText: boolean;
  d: Dictionary;
}) {
  const [pending, startTransition] = useTransition();
  const [shareOpen, setShareOpen] = useState(false);
  const [shareType, setShareType] = useState<"url" | "text">(canOpenUrl ? "url" : "text");
  const [value, setValue] = useState("");
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);

  function submit() {
    if (!value.trim() || pending) return;
    startTransition(async () => {
      const response = await sendDeviceShare(id, shareType, value);
      setResult(response);
      if (response.ok) setValue("");
    });
  }

  const error = result?.error === "invalid"
    ? d.devices.shareInvalid
    : result?.error === "unsupported"
      ? d.devices.shareUnsupported
      : result?.error === "full"
        ? d.devices.shareQueueFull
        : d.devices.shareUnavailable;

  return (
    <div className="flex flex-wrap gap-2">
      {(canOpenUrl || canReceiveText) && (
        <Button disabled={pending} onClick={() => { setResult(null); setShareOpen(true); }}>
          {d.devices.sendContent}
        </Button>
      )}
      {canNotify && (
        <Button disabled={pending} onClick={() => startTransition(() => sendDeviceTestNotification(id))}>
          {d.devices.testNotification}
        </Button>
      )}
      <Button
        variant="danger"
        disabled={pending}
        onClick={() => {
          if (window.confirm(d.devices.revokeConfirm)) startTransition(() => revokeDevice(id));
        }}
      >
        {d.devices.revoke}
      </Button>

      <Dialog open={shareOpen} onClose={() => setShareOpen(false)} title={d.devices.sendContent}>
        <div className="space-y-4">
          {canOpenUrl && canReceiveText && (
            <Field label={d.devices.contentType}>
              <Select value={shareType} onChange={(event) => { setShareType(event.target.value === "text" ? "text" : "url"); setResult(null); }}>
                <option value="url">{d.devices.link}</option>
                <option value="text">{d.devices.text}</option>
              </Select>
            </Field>
          )}
          <Field label={shareType === "url" ? d.devices.link : d.devices.text} hint={d.devices.shareApprovalHint}>
            {shareType === "url" ? (
              <Input
                type="url"
                value={value}
                maxLength={4096}
                onChange={(event) => { setValue(event.target.value); setResult(null); }}
                placeholder="https://example.com"
                autoFocus
              />
            ) : (
              <Textarea
                value={value}
                maxLength={8000}
                rows={7}
                onChange={(event) => { setValue(event.target.value); setResult(null); }}
                autoFocus
              />
            )}
          </Field>
          {result && (
            <p className={`text-sm ${result.ok ? "text-ok" : "text-danger"}`} role="status">
              {result.ok ? d.devices.shareSent : error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button disabled={pending} onClick={() => setShareOpen(false)}>{d.common.cancel}</Button>
            <Button variant="primary" disabled={pending || !value.trim()} onClick={submit}>
              {pending ? d.common.loading : d.devices.send}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
