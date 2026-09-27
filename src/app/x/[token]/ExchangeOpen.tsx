"use client";

import { useRef, useState } from "react";
import type { Dictionary } from "@/i18n";

type Exchange = {
  kind: string;
  filename: string | null;
  size: number | null;
  deleteAfterOpen: boolean;
  expiresAt: string;
};

export function ExchangeOpen({ token, exchange, d }: { token: string; exchange: Exchange; d: Dictionary["exchange"] }) {
  const [text, setText] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const textField = useRef<HTMLTextAreaElement>(null);

  async function openText() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/exchange/${token}/open`, { method: "POST", cache: "no-store" });
      const data = await response.json();
      if (!response.ok || typeof data.text !== "string") throw new Error(d.unavailable);
      setText(data.text);
      setNotice("");
    } catch (error) { setNotice(error instanceof Error ? error.message : d.error); }
    finally { setBusy(false); }
  }

  async function copyText() {
    if (text === null) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        textField.current?.select();
        if (!document.execCommand("copy")) throw new Error();
      }
      setNotice(d.copied);
    } catch { setNotice(d.error); }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-5 py-12">
      <div className="border-b border-line pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">HomePlace</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{exchange.kind === "file" ? exchange.filename : d.text}</h1>
        <p className="mt-2 text-sm text-muted">{d.expires}: {new Date(exchange.expiresAt).toLocaleString()}</p>
      </div>
      {exchange.kind === "file" ? (
        <div className="mt-7">
          <p className="text-sm text-muted">{exchange.size !== null ? `${(exchange.size / 1024 / 1024).toFixed(1)} MB` : ""}</p>
          <a href={`/api/exchange/${token}/file`} onClick={() => { if (exchange.deleteAfterOpen) setNotice(d.onceWarning); }}
            className="mt-4 inline-flex rounded-control bg-accent px-5 py-2.5 text-sm font-semibold text-accent-fg">{d.download}</a>
        </div>
      ) : text === null ? (
        <button type="button" disabled={busy} onClick={openText}
          className="mt-7 self-start rounded-control bg-accent px-5 py-2.5 text-sm font-semibold text-accent-fg disabled:opacity-50">{d.open}</button>
      ) : (
        <div className="mt-7">
          <textarea ref={textField} readOnly value={text} aria-label={d.text} rows={8}
            className="w-full resize-y rounded-control border border-line bg-surface p-4 text-sm leading-6 text-text" />
          <button type="button" onClick={copyText} className="mt-3 rounded-control border border-line px-4 py-2 text-sm font-medium">{d.copyText}</button>
        </div>
      )}
      {exchange.deleteAfterOpen && <p className="mt-4 text-xs leading-5 text-muted">{d.onceWarning}</p>}
      {notice && <p role="status" className="mt-4 text-sm text-muted">{notice}</p>}
    </main>
  );
}
