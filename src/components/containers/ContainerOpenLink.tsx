"use client";

import { useEffect, useState, type ReactNode } from "react";
import { containerOpenUrl } from "@/lib/containerUrl";

export function ContainerOpenLink({
  suggestedUrl,
  label,
  className,
  children,
}: {
  suggestedUrl?: string;
  label: string;
  className: string;
  children: ReactNode;
}) {
  const [browserHost, setBrowserHost] = useState<string>();
  useEffect(() => setBrowserHost(window.location.hostname), []);

  const href = containerOpenUrl(suggestedUrl, browserHost);
  if (!href) return null;

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label} className={className}>
      {children}
    </a>
  );
}
