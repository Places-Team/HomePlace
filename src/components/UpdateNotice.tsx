"use client";

import { useEffect, useState } from "react";
import type { Dictionary } from "@/i18n";
import type { HomePlaceUpdate } from "@/lib/updates";

const DISMISSED_UPDATE_KEY = "homeplace.dismissed-update";

export function UpdateNotice({ d, update }: { d: Dictionary; update: HomePlaceUpdate }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(localStorage.getItem(DISMISSED_UPDATE_KEY) !== update.latestVersion);
    } catch {
      setVisible(true);
    }
  }, [update.latestVersion]);

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_UPDATE_KEY, update.latestVersion);
    } catch {
      // The notice can still be dismissed for this page when storage is blocked.
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <aside className="border-b border-accent/25 bg-accent/10" aria-label={d.updates.title}>
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm sm:px-6">
        <span className="font-medium text-text">
          <span aria-hidden className="mr-1.5 text-accent">↑</span>
          {d.updates.available.replace("{version}", update.latestVersion)}
        </span>
        <span className="text-xs text-muted">
          {d.updates.current.replace("{version}", update.currentVersion)}
        </span>
        <a
          href={update.releaseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-accent underline-offset-4 hover:underline"
        >
          {d.updates.review}
          <span aria-hidden className="ml-1">↗</span>
        </a>
        <button
          type="button"
          onClick={dismiss}
          className="ml-auto rounded-control px-2 py-0.5 text-muted transition-colors hover:bg-raised hover:text-text"
          aria-label={d.updates.dismiss}
        >
          ×
        </button>
      </div>
    </aside>
  );
}
