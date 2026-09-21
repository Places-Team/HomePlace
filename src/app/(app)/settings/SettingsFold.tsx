"use client";

import type { ReactNode } from "react";
import { TileIcon } from "@/components/TileIcon";

export function SettingsFold({ title, icon, fallback, configured, children }: { title: string; icon?: string; fallback?: string; configured: boolean; children: ReactNode }) {
  return (
    <details open={!configured} className="group rounded-card border border-line bg-surface shadow-sm open:bg-raised/30">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 marker:hidden">
        <TileIcon icon={icon} title={title} fallback={fallback ?? "•"} size="md" />
        <span className="min-w-0 flex-1 font-medium">{title}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] ${configured ? "bg-ok/15 text-ok" : "bg-raised text-muted"}`}>{configured ? "on" : "setup"}</span>
        <span className="text-muted transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="border-t border-line p-2 [&>div]:border-0 [&>div]:shadow-none">{children}</div>
    </details>
  );
}
