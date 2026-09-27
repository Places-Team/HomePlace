"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Input, Select } from "@/components/form";
import type { Dictionary } from "@/i18n";

/**
 * Filtering the feed.
 *
 * The state goes into the URL rather than into the component: a filtered view
 * is then a link — "the week jellyfin kept dropping out" can be bookmarked, or
 * pasted to someone else.
 */
export function EventFilters({
  d,
  type,
  q,
  severity,
}: {
  d: Dictionary;
  type: string;
  q: string;
  severity: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [text, setText] = useState(q);

  function apply(next: { type?: string; q?: string; severity?: string }) {
    const search = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) search.set(key, value);
      else search.delete(key);
    }
    router.push(`/events?${search.toString()}`);
  }

  const kinds = [
    { value: "", label: d.events.allKinds },
    { value: "down", label: d.events.wentDown },
    { value: "up", label: d.events.cameUp },
    { value: "restart", label: d.events.restarted },
    { value: "container", label: d.events.container },
    { value: "telegram-bot", label: d.events.telegramBot },
    { value: "command", label: d.events.command },
    { value: "login", label: d.events.signedIn },
    { value: "auth-fail", label: d.events.authFailed },
    { value: "system", label: d.events.system },
  ];

  const severities = [
    { value: "", label: d.events.allSeverities },
    { value: "error", label: d.settings.sevError },
    { value: "warn", label: d.events.warnings },
    { value: "info", label: d.events.infos },
  ];

  return (
    <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply({ q: text });
        }}
        onBlur={() => {
          if (text !== q) apply({ q: text });
        }}
        placeholder={d.common.search}
        aria-label={d.common.search}
        className="!w-full sm:!w-44"
      />
      <Select value={type} onChange={(e) => apply({ type: e.target.value })} aria-label={d.events.allKinds} className="!w-full sm:!w-44">
        {kinds.map((kind) => (
          <option key={kind.value} value={kind.value}>
            {kind.label}
          </option>
        ))}
      </Select>
      <Select value={severity} onChange={(e) => apply({ severity: e.target.value })} aria-label={d.events.allSeverities} className="!w-full sm:!w-40">
        {severities.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
