"use client";

import { useEffect, useState } from "react";
import { dashboardIconUrl } from "@/lib/icons";
import { PLATFORM_NAMES } from "@/lib/deviceWorkspace";
import { DevicesIcon } from "@/components/NavIcons";
import styles from "./DevicesWorkspace.module.css";

const logos: Record<string, string> = { macos: "apple", ios: "apple", windows: "windows-11", android: "android-robot", linux: "linux" };

/** Keep SSR dates deterministic, then use the browser's zone after hydration. */
export function useDeviceTimeZone() {
  const [zone, setZone] = useState("UTC");
  useEffect(() => { setZone(Intl.DateTimeFormat().resolvedOptions().timeZone); }, []);
  return zone;
}

export function DeviceLogo({ platform, className = "h-11 w-11" }: { platform: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const slug = logos[platform];
  return <span className={`flex shrink-0 items-center justify-center rounded-xl bg-raised ${className}`}>
    {slug && !failed ? (
      // Product marks share the existing pinned Dashboard Icons attribution.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={dashboardIconUrl(slug)} alt={PLATFORM_NAMES[platform] ?? platform} loading="lazy" draggable={false}
        className={`h-3/5 w-3/5 object-contain ${platform === "macos" || platform === "ios" ? styles.apple : ""}`} onError={() => setFailed(true)} />
    ) : <DevicesIcon className="h-6 w-6 text-muted" />}
  </span>;
}

export function AccountIcon({ className = "h-5 w-5" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
    <circle cx="12" cy="8" r="3.5" /><path d="M4.5 21v-2a7.5 7.5 0 0 1 15 0v2" />
  </svg>;
}

export function GraphIcon({ className = "h-5 w-5" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
    <rect x="9" y="2.5" width="6" height="5" rx="1.2" /><rect x="2" y="16" width="6" height="5" rx="1.2" /><rect x="16" y="16" width="6" height="5" rx="1.2" />
    <path d="M12 7.5V12M5 16v-4h14v4" />
  </svg>;
}

export function ListIcon({ className = "h-5 w-5" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
    <path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3" cy="6" r=".6" /><circle cx="3" cy="12" r=".6" /><circle cx="3" cy="18" r=".6" />
  </svg>;
}

export function ZoomIcon({ minus = false }: { minus?: boolean }) {
  return <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M5 12h14" />{!minus && <path d="M12 5v14" />}</svg>;
}
