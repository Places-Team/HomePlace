"use client";

import { useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/i18n";

type Labels = Dictionary["exchange"];
type Exchange = {
  token: string;
  kind: "text" | "file";
  access: "link" | "account";
  filename: string | null;
  size: number | null;
  deleteAfterOpen: boolean;
  expiresAt: string;
};

async function copy(value: string, fallback: HTMLInputElement | null): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(value); return true; } catch { /* Try selection below. */ }
  }
  const field = fallback ?? document.createElement("input");
  if (!fallback) {
    field.value = value;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
  }
  field.focus();
  field.select();
  const copied = document.execCommand("copy");
  if (!fallback) field.remove();
  return copied;
}

function encodedFilename(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

export function ExchangeBoard({ d, serverOrigin }: { d: Labels; serverOrigin: string | null }) {
  const [kind, setKind] = useState<"text" | "file">("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [expiresInSeconds, setExpiresInSeconds] = useState(3600);
  const [access, setAccess] = useState<"link" | "account">("link");
  const [deleteAfterOpen, setDeleteAfterOpen] = useState(false);
  const [items, setItems] = useState<Exchange[]>([]);
  const [latest, setLatest] = useState<string | null>(null);
  const [localOrigin, setLocalOrigin] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const latestInput = useRef<HTMLInputElement>(null);

  useEffect(() => { setLocalOrigin(window.location.origin); }, []);
  const linkFor = (origin: string, token: string) => `${origin}/x/${token}`;
  const alternateOrigin = serverOrigin && serverOrigin !== localOrigin ? serverOrigin : null;

  useEffect(() => {
    let active = true;
    fetch("/api/exchange", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { exchanges: Exchange[] }) => { if (active) setItems(data.exchanges); })
      .catch(() => { if (active) setNotice(d.error); });
    return () => { active = false; };
  }, [d.error]);

  async function create() {
    if (busy || (kind === "text" ? !text.trim() : !file)) return;
    setBusy(true);
    setNotice("");
    try {
      let response: Response;
      if (kind === "text") {
        response = await fetch("/api/exchange", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, expiresInSeconds, access, deleteAfterOpen }),
        });
      } else {
        response = await fetch("/api/exchange/file", {
          method: "POST",
          headers: {
            "content-type": file!.type || "application/octet-stream",
            "x-homeplace-size": String(file!.size),
            "x-homeplace-filename-base64": encodedFilename(file!.name),
            "x-homeplace-expires": String(expiresInSeconds),
            "x-homeplace-access": access,
            "x-homeplace-delete-after-open": String(deleteAfterOpen),
          },
          body: file,
        });
      }
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : d.error);
      const item = data.exchange as Exchange;
      setItems((current) => [item, ...current]);
      setLatest(item.token);
      setNotice(d.created);
      setText("");
      setFile(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : d.error);
    } finally {
      setBusy(false);
    }
  }

  async function remove(token: string) {
    if (!window.confirm(d.deleteConfirm)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/exchange/${token}`, { method: "DELETE" });
      if (!response.ok) throw new Error(d.error);
      setItems((current) => current.filter((item) => item.token !== token));
      if (latest === token) setLatest(null);
      setNotice("");
    } catch { setNotice(d.error); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-7">
      <section className="rounded-card border border-line bg-surface p-5 sm:p-6">
        <div className="mb-5 flex gap-1 border-b border-line" role="tablist" aria-label={d.title}>
          {(["text", "file"] as const).map((item) => (
            <button key={item} type="button" role="tab" aria-selected={kind === item} onClick={() => setKind(item)}
              className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${kind === item ? "border-accent text-text" : "border-transparent text-muted hover:text-text"}`}>
              {d[item]}
            </button>
          ))}
        </div>
        {kind === "text" ? (
          <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={d.textPlaceholder} aria-label={d.text}
            maxLength={16384} rows={6} className="w-full resize-y rounded-control border border-line bg-raised p-3 text-sm leading-6 text-text outline-none focus:border-accent" />
        ) : (
          <div className="rounded-control border border-dashed border-line bg-raised p-5">
            <label className="block text-sm font-medium">{d.chooseFile}
              <input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="mt-3 block w-full text-sm" />
            </label>
            {file && <p className="mt-2 break-all text-sm text-muted">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</p>}
            <p className="mt-2 text-xs text-muted">{d.fileLimit}</p>
          </div>
        )}
        <div className="mt-5 flex flex-wrap gap-4">
          <label className="min-w-40 flex-1 text-xs font-medium text-muted">{d.expires}
            <select value={expiresInSeconds} onChange={(event) => setExpiresInSeconds(Number(event.target.value))}
              className="mt-1 block w-full rounded-control border border-line bg-raised px-3 py-2.5 text-sm text-text">
              <option value={600}>{d.tenMinutes}</option><option value={3600}>{d.oneHour}</option><option value={86400}>{d.oneDay}</option>
            </select>
          </label>
          <label className="min-w-52 flex-1 text-xs font-medium text-muted">{d.access}
            <select value={access} onChange={(event) => setAccess(event.target.value as "link" | "account")}
              className="mt-1 block w-full rounded-control border border-line bg-raised px-3 py-2.5 text-sm text-text">
              <option value="link">{d.linkAccess}</option><option value="account">{d.accountAccess}</option>
            </select>
          </label>
        </div>
        <label className="mt-4 flex items-start gap-2 text-sm text-text">
          <input type="checkbox" checked={deleteAfterOpen} onChange={(event) => setDeleteAfterOpen(event.target.checked)} className="mt-1" />
          {d.oneTime}
        </label>
        <p className="mt-2 text-xs leading-5 text-muted">{access === "link" ? d.publicWarning : d.private}</p>
        {deleteAfterOpen && <p className="mt-1 text-xs leading-5 text-muted">{d.onceWarning}</p>}
        <button type="button" disabled={busy || (kind === "text" ? !text.trim() : !file)} onClick={create}
          className="mt-5 rounded-control bg-accent px-5 py-2.5 text-sm font-semibold text-accent-fg disabled:opacity-50">
          {d.create}
        </button>
        {latest && (
          <div className="mt-5 flex flex-wrap gap-2">
            <input ref={latestInput} readOnly value={linkFor(localOrigin, latest)} aria-label={d.currentAddress} className="min-w-0 flex-1 rounded-control border border-line bg-raised px-3 py-2 text-sm text-text" />
            <button type="button" onClick={async () => setNotice(await copy(linkFor(localOrigin, latest), latestInput.current) ? d.copied : d.error)}
              className="rounded-control border border-line px-3 py-2 text-sm font-medium">{d.copyLink}</button>
            {alternateOrigin && <button type="button" onClick={async () => setNotice(await copy(linkFor(alternateOrigin, latest), null) ? d.copied : d.error)}
              className="rounded-control border border-line px-3 py-2 text-sm font-medium">{d.copyServerLink}</button>}
          </div>
        )}
        {notice && <p role="status" className="mt-3 text-sm text-muted">{notice}</p>}
      </section>

      <section aria-labelledby="exchange-recent" className="space-y-2">
        <h2 id="exchange-recent" className="text-lg font-semibold">{d.recent}</h2>
        {items.length === 0 ? <p className="border-t border-line py-5 text-sm text-muted">{d.empty}</p> : (
          <ul className="divide-y divide-line border-t border-line">
            {items.map((item) => {
              const url = linkFor(localOrigin, item.token);
              return <li key={item.token} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.kind === "file" ? item.filename : d.text}</p>
                  <p className="text-xs text-muted">{new Date(item.expiresAt).toLocaleString()} · {item.access === "link" ? d.linkAccess : d.accountAccess}{item.deleteAfterOpen ? ` · ${d.oneTime}` : ""}</p>
                </div>
                <input readOnly value={url} aria-label={d.copyLink} className="w-40 rounded-control border border-line bg-raised px-2 py-1.5 text-xs text-text sm:w-64" />
                <button type="button" onClick={async (event) => {
                  const field = event.currentTarget.previousElementSibling as HTMLInputElement | null;
                  setNotice(await copy(url, field) ? d.copied : d.error);
                }} className="rounded-control border border-line px-3 py-1.5 text-xs font-medium">{d.copyLink}</button>
                {alternateOrigin && <button type="button" onClick={async () => setNotice(await copy(linkFor(alternateOrigin, item.token), null) ? d.copied : d.error)}
                  className="rounded-control border border-line px-3 py-1.5 text-xs font-medium">{d.copyServerLink}</button>}
                <button type="button" disabled={busy} onClick={() => remove(item.token)} className="rounded-control px-2 py-1.5 text-xs text-muted hover:text-danger">{d.delete}</button>
              </li>;
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
