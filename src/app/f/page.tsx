import type { Metadata } from "next";
import { headers } from "next/headers";
import { dict } from "@/i18n";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function QuickExchangePage() {
  const language = (await headers()).get("accept-language")?.toLowerCase().startsWith("ru") ? "ru" : "en";
  const d = dict(language).exchange;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">HomePlace</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{d.quickEnter}</h1>
      <p className="mt-2 text-sm text-muted">{d.quickHint}</p>
      <form action="/f/open" method="get" className="mt-7 flex gap-2">
        <input name="code" aria-label={d.quickEnter} required minLength={5} maxLength={5}
          autoCapitalize="off" autoComplete="off" spellCheck={false}
          className="min-w-0 flex-1 rounded-control border border-line bg-surface px-4 py-3 font-mono text-xl tracking-[0.16em] text-text" />
        <button type="submit" className="rounded-control bg-accent px-5 py-3 text-sm font-semibold text-accent-fg">{d.open}</button>
      </form>
    </main>
  );
}
