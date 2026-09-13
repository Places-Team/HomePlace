"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog } from "./Dialog";
import { Input, Button } from "./form";
import { TileIcon } from "./TileIcon";
import { ImagePicker } from "./ImagePicker";
import { SERVICE_ICONS, GENERAL_ICONS, dashboardIconUrl, iconPackUrl } from "@/lib/icons";
import type { Dictionary } from "@/i18n";

/**
 * Choosing an icon without pasting a URL.
 *
 * Three sources in one place, in the order people actually want them: the
 * service this tile is (matched by name, drawn from the bundled set), a general
 * set for everything else, and finally an image — uploaded or linked.
 *
 * The bundled sets are emoji rather than files. They cost nothing to ship, work
 * with no network, and render at any size; the community logo pack is offered
 * alongside for anyone who has enabled it.
 */
export function IconPicker({
  d,
  value,
  onChange,
  hintName,
  online = false,
}: {
  d: Dictionary;
  value: string;
  onChange: (icon: string) => void;
  /** Tile title or container name, used to suggest the matching service icons. */
  hintName?: string;
  /** The administrator explicitly enabled public Dashboard Icons requests. */
  online?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<string[] | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);

  useEffect(() => {
    if (!open || !online || catalog || catalogFailed) return;
    const controller = new AbortController();
    fetch("/api/icons", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("catalogue unavailable");
        const body = (await response.json()) as { icons?: unknown };
        if (!Array.isArray(body.icons)) throw new Error("invalid catalogue");
        setCatalog(body.icons.filter((entry): entry is string => typeof entry === "string"));
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== "AbortError") setCatalogFailed(true);
      });
    return () => controller.abort();
  }, [open, online, catalog, catalogFailed]);

  const services = useMemo(() => {
    const needle = (query || hintName || "").toLowerCase().trim();
    const entries = Object.entries(SERVICE_ICONS);
    if (!needle) return entries.slice(0, 48);
    // Matches in both directions: typing "jelly" finds jellyfin, and a tile
    // called "jellyfin" finds it without typing anything.
    return entries.filter(([key]) => key.includes(needle) || needle.includes(key)).slice(0, 48);
  }, [query, hintName]);

  const general = useMemo(() => {
    if (!query.trim()) return GENERAL_ICONS;
    return GENERAL_ICONS.filter((icon) => icon.includes(query.trim()));
  }, [query]);

  const catalogMatches = useMemo(() => {
    if (!catalog) return [];
    const needle = (query || hintName || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-");
    if (!needle) return catalog.slice(0, 72);
    const words = needle.split("-").filter((word) => word.length > 1);
    return catalog.filter((slug) => slug.includes(needle) || words.some((word) => slug.includes(word))).slice(0, 96);
  }, [catalog, query, hintName]);

  function choose(icon: string) {
    onChange(icon);
    setOpen(false);
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-control border border-line bg-raised px-2.5 py-1.5 text-sm transition-colors hover:bg-surface"
        >
          <TileIcon icon={value} title={hintName || "?"} size="sm" />
          <span className="text-xs text-muted">{d.dashboard.chooseIcon}</span>
        </button>
        {value && (
          <Button size="sm" variant="quiet" onClick={() => onChange("")}>
            {d.common.delete}
          </Button>
        )}
      </div>

      {open && (
        <Dialog open onClose={() => setOpen(false)} title={d.dashboard.chooseIcon} wide>
          <div className="flex flex-col gap-4">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={d.common.search} autoFocus />

            {services.length > 0 && (
              <section>
                <p className="mb-1.5 text-xs font-medium text-muted">{d.dashboard.iconServices}</p>
                <div className="flex flex-wrap gap-1">
                  {services.map(([key, icon]) => (
                    <button
                      key={key}
                      type="button"
                      title={key}
                      onClick={() => choose(icon)}
                      className="flex h-9 w-9 items-center justify-center rounded-control border border-line text-lg transition-colors hover:border-accent hover:bg-raised"
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section>
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-muted">{d.dashboard.iconCatalog}</p>
                {catalog && <span className="text-[11px] text-faint">{catalog.length}</span>}
              </div>
              {!online && <p className="text-xs text-muted">{d.dashboard.iconCatalogDisabled}</p>}
              {online && !catalog && !catalogFailed && <p className="text-xs text-muted">{d.common.loading}</p>}
              {online && catalogFailed && <p className="text-xs text-muted">{d.dashboard.iconCatalogUnavailable}</p>}
              {catalogMatches.length > 0 && (
                <div className="grid grid-cols-8 gap-1 sm:grid-cols-12">
                  {catalogMatches.map((slug) => (
                    <button
                      key={slug}
                      type="button"
                      title={slug}
                      onClick={() => choose(dashboardIconUrl(slug))}
                      className="flex h-10 w-10 items-center justify-center rounded-control border border-line transition-colors hover:border-accent hover:bg-raised"
                    >
                      <TileIcon icon={dashboardIconUrl(slug)} title={slug} size="md" />
                    </button>
                  ))}
                </div>
              )}
              {catalog && catalogMatches.length === 0 && (
                <p className="text-xs text-muted">{d.dashboard.iconCatalogEmpty}</p>
              )}
              {online && <p className="mt-2 text-[11px] text-faint">{d.dashboard.iconCatalogHint}</p>}
            </section>

            <section>
              <p className="mb-1.5 text-xs font-medium text-muted">{d.dashboard.iconGeneral}</p>
              <div className="flex flex-wrap gap-1">
                {general.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    onClick={() => choose(icon)}
                    className="flex h-9 w-9 items-center justify-center rounded-control border border-line text-lg transition-colors hover:border-accent hover:bg-raised"
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </section>

            {hintName && iconPackUrl({ name: hintName }) && (
              <section>
                <p className="mb-1.5 text-xs font-medium text-muted">{d.dashboard.iconLogo}</p>
                <button
                  type="button"
                  onClick={() => choose(iconPackUrl({ name: hintName }))}
                  className="flex items-center gap-2 rounded-control border border-line px-3 py-2 transition-colors hover:border-accent hover:bg-raised"
                >
                  <TileIcon icon={iconPackUrl({ name: hintName })} title={hintName} size="sm" />
                  <span className="text-xs text-muted">{hintName}</span>
                </button>
              </section>
            )}

            <section>
              <p className="mb-1.5 text-xs font-medium text-muted">{d.dashboard.iconImage}</p>
              <ImagePicker d={d} value={value.startsWith("http") || value.startsWith("/") ? value : ""} onChange={choose} />
            </section>
          </div>
        </Dialog>
      )}
    </>
  );
}
