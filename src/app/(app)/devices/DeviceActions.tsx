"use client";

import { useRef, useState, useTransition } from "react";
import {
  approvePairing,
  rejectPairing,
  revokeDevice,
  sendDeviceShare,
  sendDeviceTestNotification,
  updateDeviceHouseholdSharing,
} from "@/actions/linkDevices";
import { Dialog } from "@/components/Dialog";
import { Button, Field, Input, Select, Textarea } from "@/components/form";
import type { Dictionary } from "@/i18n";

const MAX_FILE_BYTES = 64 * 1024 * 1024;

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
  canReceiveFile,
  allowHouseholdShares,
  d,
}: {
  id: string;
  canNotify: boolean;
  canOpenUrl: boolean;
  canReceiveText: boolean;
  canReceiveFile: boolean;
  allowHouseholdShares: boolean;
  d: Dictionary;
}) {
  const [pending, startTransition] = useTransition();
  const [shareOpen, setShareOpen] = useState(false);
  const [shareType, setShareType] = useState<"url" | "text" | "file">(
    canOpenUrl ? "url" : canReceiveText ? "text" : "file",
  );
  const [value, setValue] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const upload = useRef<XMLHttpRequest | null>(null);
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const busy = pending || uploading;

  function submit() {
    if (busy) return;
    if (shareType === "file") {
      if (file) sendFile(file);
      return;
    }
    if (!value.trim()) return;
    startTransition(async () => {
      const response = await sendDeviceShare(id, shareType, value);
      setResult(response);
      if (response.ok) setValue("");
    });
  }

  function sendFile(selected: File) {
    const request = new XMLHttpRequest();
    upload.current = request;
    setUploading(true);
    setProgress(0);
    setResult(null);
    request.open("POST", "/api/link/share/file");
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) setProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    });
    request.addEventListener("load", () => {
      let response: { ok?: boolean; error?: string } = {};
      try {
        response = JSON.parse(request.responseText) as { ok?: boolean; error?: string };
      } catch {
        response = {};
      }
      const error = request.status === 413
        ? "too-large"
        : request.status === 429
          ? "full"
          : request.status === 404
            ? "unavailable"
            : "invalid";
      setResult(request.status >= 200 && request.status < 300 && response.ok
        ? { ok: true }
        : { ok: false, error });
      if (request.status >= 200 && request.status < 300) setFile(null);
      setProgress(request.status >= 200 && request.status < 300 ? 100 : 0);
      setUploading(false);
      upload.current = null;
    });
    request.addEventListener("error", () => {
      setResult({ ok: false, error: "unavailable" });
      setUploading(false);
      upload.current = null;
    });
    request.addEventListener("abort", () => {
      setResult({ ok: false, error: "cancelled" });
      setUploading(false);
      setProgress(0);
      upload.current = null;
    });
    const body = new FormData();
    body.set("targetDeviceId", id);
    body.set("file", selected);
    request.send(body);
  }

  function closeShare() {
    if (uploading) upload.current?.abort();
    setShareOpen(false);
  }

  const error = result?.error === "invalid"
    ? d.devices.shareInvalid
    : result?.error === "unsupported"
      ? d.devices.shareUnsupported
      : result?.error === "full"
        ? d.devices.shareQueueFull
        : result?.error === "too-large"
          ? d.devices.fileTooLarge
          : result?.error === "cancelled"
            ? d.devices.uploadCancelled
        : d.devices.shareUnavailable;

  return (
    <div className="flex flex-wrap gap-2">
      {(canOpenUrl || canReceiveText || canReceiveFile) && (
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
        disabled={pending}
        onClick={() => startTransition(() => updateDeviceHouseholdSharing(id, !allowHouseholdShares))}
      >
        {allowHouseholdShares ? d.devices.disableHouseholdSharing : d.devices.enableHouseholdSharing}
      </Button>
      <Button
        variant="danger"
        disabled={pending}
        onClick={() => {
          if (window.confirm(d.devices.revokeConfirm)) startTransition(() => revokeDevice(id));
        }}
      >
        {d.devices.revoke}
      </Button>

      <Dialog open={shareOpen} onClose={closeShare} title={d.devices.sendContent}>
        <div className="space-y-4">
          {[canOpenUrl, canReceiveText, canReceiveFile].filter(Boolean).length > 1 && (
            <Field label={d.devices.contentType}>
              <Select value={shareType} disabled={busy} onChange={(event) => {
                const next = event.target.value;
                setShareType(next === "text" || next === "file" ? next : "url");
                setResult(null);
              }}>
                {canOpenUrl && <option value="url">{d.devices.link}</option>}
                {canReceiveText && <option value="text">{d.devices.text}</option>}
                {canReceiveFile && <option value="file">{d.devices.file}</option>}
              </Select>
            </Field>
          )}
          <Field
            label={shareType === "url" ? d.devices.link : shareType === "file" ? d.devices.file : d.devices.text}
            hint={shareType === "file" ? d.devices.fileApprovalHint : d.devices.shareApprovalHint}
          >
            {shareType === "url" ? (
              <Input
                type="url"
                value={value}
                maxLength={4096}
                onChange={(event) => { setValue(event.target.value); setResult(null); }}
                placeholder="https://example.com"
                autoFocus
              />
            ) : shareType === "text" ? (
              <Textarea
                value={value}
                maxLength={8000}
                rows={7}
                onChange={(event) => { setValue(event.target.value); setResult(null); }}
                autoFocus
              />
            ) : (
              <Input
                type="file"
                disabled={busy}
                onChange={(event) => {
                  const selected = event.target.files?.[0] ?? null;
                  if (selected && selected.size > MAX_FILE_BYTES) {
                    setFile(null);
                    setResult({ ok: false, error: "too-large" });
                    event.target.value = "";
                    return;
                  }
                  setFile(selected);
                  setProgress(0);
                  setResult(null);
                }}
                autoFocus
              />
            )}
          </Field>
          {uploading && (
            <div className="space-y-1" aria-live="polite">
              <div className="h-1.5 overflow-hidden rounded-full bg-line">
                <div className="h-full bg-accent transition-[width]" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-muted">{d.devices.uploadingFile.replace("{progress}", String(progress))}</p>
            </div>
          )}
          {result && (
            <p className={`text-sm ${result.ok ? "text-ok" : "text-danger"}`} role="status">
              {result.ok ? d.devices.shareSent : error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button disabled={pending} onClick={closeShare}>{uploading ? d.devices.cancelUpload : d.common.cancel}</Button>
            <Button
              variant="primary"
              disabled={busy || (shareType === "file" ? !file : !value.trim())}
              onClick={submit}
            >
              {busy ? d.common.loading : d.devices.send}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
