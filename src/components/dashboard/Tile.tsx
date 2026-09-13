import Link from "next/link";
import type { Item } from "@prisma/client";
import { Card, StatusDot, TileIcon, Meter, type StatusKind } from "@/components/ui";
import { Widget } from "@/components/widgets";
import { ItemActions } from "./ItemActions";
import { HideWhenEditing } from "./EditMode";
import { FolderContents } from "./FolderContents";
import { TileControls } from "./TileControls";
import type { TileStatus } from "@/lib/status";
import { percent, latency, bytes } from "@/lib/format";
import { GLYPH, autoIcon, guessIcon } from "@/lib/icons";
import type { Dictionary } from "@/i18n";

type ItemWithChildren = Item & { children?: ItemWithChildren[] };

/**
 * What the container behind a tile is doing right now.
 *
 * Read on the page and handed in, rather than fetched here: one call per host
 * for the whole board instead of one per tile, and the tile stays a component
 * that renders what it is given.
 */
export type TileLive = {
  id: string;
  state: string;
  status: string;
  image: string;
  ports: { internal: number; external?: number; protocol: string }[];
  /** Percent and bytes, present only for the tiles that asked for them. */
  cpu?: number;
  memory?: number;
};

/**
 * One tile.
 *
 * A tile is first of all a link — the reason to open this page is to get
 * somewhere else quickly. Status, uptime and controls are decoration around
 * that link, and edit controls appear only in edit mode so the normal view
 * stays clickable everywhere.
 */
export function Tile({
  item,
  statuses,
  d,
  inFolder = false,
  canEdit,
  iconPack = false,
  userId,
  live,
}: {
  item: ItemWithChildren;
  statuses: Map<string, TileStatus>;
  d: Dictionary;
  /** A tile rendered inside a folder dialog: it never gets edit controls. */
  inFolder?: boolean;
  canEdit: boolean;
  iconPack?: boolean;
  /** Passed to widgets that show something personal, such as the calendar. */
  userId?: string;
  /** Live container data, for the tiles configured to show any of it. */
  live?: TileLive;
}) {
  // Resolved here rather than stored: a tile created before icon guessing
  // existed, or one whose address changed, picks up an icon without anyone
  // opening the edit dialog.
  const icon =
    item.icon ||
    autoIcon({ name: item.containerName ?? item.title, url: item.url ?? item.internalUrl ?? "", pack: iconPack });
  const emoji = guessIcon({ name: item.containerName ?? item.title, url: item.url ?? item.internalUrl ?? "" });
  if (item.kind === "widget") {
    return (
      <div className="relative h-full">
        {canEdit && !inFolder && <ItemActions item={item} d={d} iconPack={iconPack} />}
        <Widget
          widget={item.widget ?? "notes"}
          config={parseConfig(item.config)}
          title={item.title}
          d={d}
          userId={userId}
          canControl={canEdit}
        />
      </div>
    );
  }

  if (item.kind === "section") {
    return (
      <div className="relative flex h-full items-end pb-1">
        {canEdit && !inFolder && <ItemActions item={item} d={d} iconPack={iconPack} />}
        <div className="w-full border-b border-line pb-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            {item.icon && <TileIcon icon={item.icon} title={item.title} size="sm" />}
            {item.title}
          </h2>
          {item.subtitle && <p className="text-xs text-muted">{item.subtitle}</p>}
        </div>
      </div>
    );
  }

  if (item.kind === "folder") {
    const children = item.children ?? [];

    // Panel mode: a folder shown open, right on the board. The tiles inside are
    // laid out on the same 12-column grid they would use outside, so each one
    // keeps its size and looks exactly as it does anywhere else — the box is
    // just a titled boundary you can drag tiles into.
    if (str(parseConfig(item.config).display) === "panel") {
      return (
        <Card className="relative flex h-full flex-col p-3">
          {canEdit && !inFolder && <ItemActions item={item} d={d} iconPack={iconPack} />}
          <div className="mb-2 flex items-center gap-2">
            {item.icon && <TileIcon icon={item.icon} title={item.title} size="sm" />}
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{item.title}</span>
            {children.length > 0 && <span className="text-xs text-faint">{children.length}</span>}
          </div>
          {children.length === 0 ? (
            <p className="px-1 text-xs text-faint">{canEdit ? d.dashboard.folderHint : d.dashboard.folderEmpty}</p>
          ) : (
            /* The panel is often only a couple of board-columns wide, so it
               cannot slice itself into the board's 12: a child at span 1 then
               became ~10px. Columns instead auto-fill to the panel's own width
               — every tile is at least ~11rem and wraps — so a narrow zone
               reads as a tidy stack, not a crushed row. */
            <div
              className="grid min-h-0 flex-1 auto-rows-min gap-3 overflow-y-auto"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 11rem), 1fr))" }}
            >
              {children.map((child) => (
                <div key={child.id} style={{ minHeight: `${Math.max(1, child.h) * 84}px` }}>
                  <Tile item={child} statuses={statuses} d={d} canEdit={canEdit} iconPack={iconPack} userId={userId} />
                </div>
              ))}
            </div>
          )}
        </Card>
      );
    }
    /*
     * What each line says besides its name.
     *
     * The folder is resizable, and a column of latencies squeezed against a
     * name in a two-column-wide folder is worse than no column at all — so the
     * detail appears only once the folder is wide enough to hold it, and the
     * choice of what it says belongs to whoever made the folder.
     */
    const detail = str(parseConfig(item.config).detail);
    const roomy = item.w >= 3;
    return (
      <Card className="relative flex h-full flex-col p-3">
        {canEdit && !inFolder && <ItemActions item={item} d={d} iconPack={iconPack} />}

        <div className="mb-2 flex items-center gap-2">
          <TileIcon icon={item.icon || GLYPH.folder} title={item.title} color={item.color} />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{item.title}</span>
          {/* Opening the folder shows the tiles themselves, fully rendered —
              they are built here on the server and handed to the dialog. */}
          <FolderContents
            d={d}
            title={item.title}
            icon={item.icon || GLYPH.folder}
            count={children.length}
            canEdit={canEdit}
            items={children.map((c) => ({ id: c.id, title: c.title, w: c.w }))}
          >
            {children.map((child) => (
              <Tile
                key={child.id}
                item={child}
                statuses={statuses}
                d={d}
                inFolder
                canEdit={canEdit}
                iconPack={iconPack}
                userId={userId}
              />
            ))}
          </FolderContents>
        </div>

        {/* The tile itself stays a compact index: icon, name, status. The full
            version is one click away and does not have to fit in a small card. */}
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {children.map((child) => {
            const childIcon =
              child.icon ||
              autoIcon({ name: child.containerName ?? child.title, url: child.url ?? "", pack: iconPack });
            const inner = (
              <>
                <TileIcon
                  icon={childIcon}
                  title={child.title}
                  size="sm"
                  fallback={guessIcon({ name: child.containerName ?? child.title, url: child.url ?? "" })}
                />
                <span className="min-w-0 flex-1 truncate">{child.title}</span>
                {detail && detail !== "none" && roomy && (
                  <span className="shrink-0 truncate font-mono text-[10px] tabular-nums text-faint">
                    {childDetail(detail, child, statuses.get(child.id), d)}
                  </span>
                )}
                {child.checkKind !== "none" && <StatusDot {...dotFor(child, statuses.get(child.id), d)} />}
              </>
            );

            // A widget in a folder has nowhere to link to; it opens with the
            // folder instead, where there is room to draw it.
            return (
              <li key={child.id}>
                {child.kind === "widget" || !child.url ? (
                  <span className="flex items-center gap-2 rounded-control px-1.5 py-1 text-sm text-muted">{inner}</span>
                ) : (
                  <a
                    href={child.url}
                    target={child.newTab ? "_blank" : undefined}
                    rel={child.newTab ? "noreferrer" : undefined}
                    className="flex items-center gap-2 rounded-control px-1.5 py-1 text-sm text-muted transition-colors hover:bg-raised hover:text-text"
                  >
                    {inner}
                  </a>
                )}
              </li>
            );
          })}
          {children.length === 0 && (
            <li className="px-1.5 text-xs text-faint">{canEdit ? d.dashboard.folderHint : d.dashboard.folderEmpty}</li>
          )}
        </ul>
      </Card>
    );
  }

  // service | link
  const status = statuses.get(item.id);
  const dot = dotFor(item, status, d);
  const href = item.url ?? item.internalUrl ?? "#";
  const isExternal = /^https?:\/\//i.test(href);

  // What the tile was asked to show besides its name. Everything here is
  // something the panel already knows about the container: the tile is where it
  // is wanted, not where it is discovered.
  const extras = parseConfig(item.config);
  const shows = (key: string) => live !== undefined && extras[key] === true;
  // Controls need an admin and a container that still exists; while editing they
  // are hidden (below), so the drag surface is not fighting five buttons.
  const withControls = shows("controls") && canEdit && !!item.hostKey && !!item.containerName;

  /*
   * A tile made small on purpose is a launcher, not a card. Below two cells in
   * either direction the title cannot fit without being clipped to a couple of
   * letters — so it drops away and the icon, which is what the eye lands on
   * anyway, takes the whole tile, with the status dot tucked in a corner.
   */
  const iconOnly = item.w <= 2 && item.h <= 1;
  const compactBody = (
    <div className="relative flex h-full flex-col items-center justify-center gap-1 text-center">
      {item.checkKind !== "none" && (
        <span className="absolute right-0 top-0">
          <StatusDot {...dot} pulse />
        </span>
      )}
      <TileIcon icon={icon} title={item.title} color={item.color} fallback={emoji} size="lg" />
    </div>
  );

  /*
   * A tile is a fixed box on the board, and the extras are opt-in: asking for
   * stats, ports and an image does not make the box taller, it fills it. So the
   * card clips instead of spilling over the tile beneath it, the header keeps
   * its size and the extras take whatever room is left — drag the tile taller
   * and more of them appear, which is the honest relationship between the two.
   */
  const body = (
    <>
      <div className="flex shrink-0 items-start gap-2.5">
        <TileIcon icon={icon} title={item.title} color={item.color} fallback={emoji} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{item.title}</span>
            <StatusDot {...dot} pulse />
          </div>
          {item.subtitle && <p className="truncate text-xs text-muted">{item.subtitle}</p>}
          {shows("image") && live!.image && (
            <p className="truncate font-mono text-[10px] text-faint" title={live!.image}>
              {live!.image}
            </p>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
      {shows("stats") && (live!.cpu !== undefined || live!.memory !== undefined) && (
        <div className="mt-2 space-y-1">
          <div className="flex items-baseline justify-between text-[10px] text-faint">
            <span>{d.monitoring.cpu}</span>
            <span className="font-mono tabular-nums">{percent(live!.cpu ?? null, 1)}</span>
          </div>
          <Meter value={live!.cpu ?? 0} />
          <div className="flex items-baseline justify-between text-[10px] text-faint">
            <span>{d.monitoring.memory}</span>
            <span className="font-mono tabular-nums">{bytes(live!.memory ?? 0)}</span>
          </div>
        </div>
      )}

      {shows("uptime") && live!.status && <p className="mt-2 truncate text-[11px] text-faint">{live!.status}</p>}

      {shows("ports") && live!.ports.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 overflow-hidden">
          {live!.ports.slice(0, 4).map((p) => (
            <span key={`${p.external}-${p.internal}`} className="rounded-control bg-raised px-1.5 text-[10px] text-muted">
              {p.external ?? p.internal}
            </span>
          ))}
        </div>
      )}
      </div>

      {item.checkKind !== "none" && (
        <div className="mt-2 flex shrink-0 items-center justify-between text-[11px] text-faint">
          <span>{dot.label}</span>
          <span className="font-mono tabular-nums">
            {status?.uptime24h !== null && status?.uptime24h !== undefined
              ? `${d.dashboard.uptime24h} ${percent(status.uptime24h, 1)}`
              : latency(status?.latency)}
          </span>
        </div>
      )}
    </>
  );

  return (
    <Card className="group relative flex h-full flex-col overflow-hidden transition-shadow hover:shadow-pop">
      {canEdit && !inFolder && <ItemActions item={item} d={d} iconPack={iconPack} />}

      {/* Attached to a container: an arrow into its detail view — logs, mounts,
          restarts. Hidden until hover so the tile stays a clean link, and gone
          entirely while editing so it does not fight the toolbar. */}
      {item.containerName && item.hostKey && (
        <HideWhenEditing>
          <Link
            href={`/containers/${encodeURIComponent(item.hostKey)}/${encodeURIComponent(item.containerName)}`}
            title={d.containers.details}
            aria-label={`${item.title} — ${d.containers.details}`}
            className="absolute right-1 top-1 z-10 rounded-control px-1.5 text-lg leading-none text-faint opacity-0 transition-opacity hover:bg-raised hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
          >
            {GLYPH.details}
          </Link>
        </HideWhenEditing>
      )}
      {isExternal ? (
        <a
          href={href}
          target={item.newTab ? "_blank" : undefined}
          rel={item.newTab ? "noreferrer" : undefined}
          className={`flex min-h-0 flex-1 flex-col p-3 ${withControls ? "pb-0" : ""}`}
        >
          {iconOnly ? compactBody : body}
        </a>
      ) : (
        <Link href={href} className={`flex min-h-0 flex-1 flex-col p-3 ${withControls ? "pb-0" : ""}`}>
          {iconOnly ? compactBody : body}
        </Link>
      )}

      {/* Outside the link on purpose: a button inside an anchor is invalid HTML
          and behaves differently in every browser that tries to make sense of
          it. */}
      {withControls && (
        <HideWhenEditing>
          <div className="shrink-0 px-3 pb-3">
            <TileControls d={d} hostKey={item.hostKey!} id={live!.id} name={item.containerName!} state={live!.state} />
          </div>
        </HideWhenEditing>
      )}
    </Card>
  );
}

/**
 * One line's extra column inside a folder.
 *
 * Everything here is already known to the page — no folder line causes a
 * request of its own — and an unknown value is an empty string rather than a
 * dash, so a folder of links does not grow a column of punctuation.
 */
function childDetail(
  detail: string,
  child: ItemWithChildren,
  status: TileStatus | undefined,
  d: Dictionary
): string {
  switch (detail) {
    case "status":
      return dotFor(child, status, d).label;
    case "latency":
      return latency(status?.latency);
    case "uptime":
      return status?.uptime24h !== null && status?.uptime24h !== undefined ? percent(status.uptime24h, 1) : "";
    case "host":
      // The address without its scheme and path: what distinguishes two tiles
      // called "Sonarr" is the host they point at.
      try {
        return child.url ? new URL(child.url).host : "";
      } catch {
        return "";
      }
    case "container":
      return child.containerName ?? "";
    default:
      return "";
  }
}

function dotFor(item: Item, status: TileStatus | undefined, d: Dictionary): { kind: StatusKind; label: string } {
  if (item.checkKind === "none") return { kind: "unknown", label: d.status.unknown };
  if (!status || status.ok === null) return { kind: "unknown", label: d.status.unknown };
  return status.ok ? { kind: "up", label: d.status.up } : { kind: "down", label: d.status.down };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Widget settings are stored as a JSON string; a broken one must not crash the page. */
function parseConfig(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
