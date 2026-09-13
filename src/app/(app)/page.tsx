import { prisma, getSetting } from "@/lib/db";
import { ensureSlugs, ensureLayout } from "@/lib/dashboards";
import { pageUser } from "@/lib/pageUser";
import { canEdit } from "@/lib/auth";
import { listContainers, statsForContainers } from "@/lib/docker";
import { resolvedDockerHosts } from "@/lib/integrations";
import { statusFor } from "@/lib/status";
import { dict } from "@/i18n";
import { EmptyState } from "@/components/ui";
import { AutoRefresh } from "@/components/AutoRefresh";
import { KioskController } from "@/components/dashboard/KioskController";
import { Board } from "@/components/dashboard/Board";
import { EditModeProvider, EditToggle, EditHints } from "@/components/dashboard/EditMode";
import { Tile, type TileLive } from "@/components/dashboard/Tile";
import { Tabs } from "@/components/dashboard/Tabs";
import { AddButton } from "@/components/dashboard/AddButton";
import { BackgroundButton } from "@/components/dashboard/BackgroundButton";
import type { ContainerOption } from "@/components/dashboard/ItemDialog";

export const dynamic = "force-dynamic";

/** Tile settings are a JSON string; a broken one must not take the page down. */
function parseConfig(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * The browser tab is named after the dashboard, not after the app. With the
 * panel pinned in a browser all day, "Home · HomePlace" is what makes it
 * findable among twenty other tabs.
 */
export async function generateMetadata({ searchParams }: { searchParams: { tab?: string } }) {
  const dashboards = await prisma.dashboard.findMany({
    orderBy: { order: "asc" },
    select: { id: true, name: true, slug: true },
  });
  const active =
    dashboards.find((x) => x.slug === searchParams.tab) ??
    dashboards.find((x) => x.id === searchParams.tab) ??
    dashboards[0];
  return { title: active ? `${active.name} · HomePlace` : "HomePlace" };
}

/**
 * The home page: tabs of tiles on a draggable board.
 *
 * Which tab is open and whether the layout is being edited both live in the
 * URL, which keeps this a plain server component — every view is a link
 * somebody can bookmark or set as their browser's home page.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { tab?: string; edit?: string };
}) {
  const user = await pageUser();
  const d = dict(user.locale);
  const editable = canEdit(user);

  // Self-healing for data written before slugs and positions existed. Both are
  // no-ops after the first run.
  await ensureSlugs();

  const dashboards = await prisma.dashboard.findMany({
    // Shared boards, plus the private ones belonging to whoever is looking.
    where: { OR: [{ shared: true }, { ownerId: user.id }] },
    orderBy: { order: "asc" },
  });
  // The tab is addressed by its slug; ids still resolve so old bookmarks and
  // links from elsewhere keep working.
  const active =
    dashboards.find((x) => x.slug === searchParams.tab) ??
    dashboards.find((x) => x.id === searchParams.tab) ??
    dashboards[0];

  if (!active) {
    return <EmptyState title={d.dashboard.empty} hint={d.dashboard.emptyHint} />;
  }

  await ensureLayout(active.id);

  const items = await prisma.item.findMany({
    where: { dashboardId: active.id, parentId: null },
    orderBy: [{ y: "asc" }, { x: "asc" }],
    include: { children: { orderBy: { order: "asc" } } },
  });

  // Children need statuses too — they are the links inside folders.
  const ids = items.flatMap((i) => [i.id, ...i.children.map((c) => c.id)]);
  const statuses = await statusFor(ids);

  // Only fetched when it can be used: the container picker in the add dialog.
  // Which containers already have a tile anywhere — the picker sends those to
  // the end of the grid instead of hiding them.
  const placed = new Set(
    (await prisma.item.findMany({ where: { containerName: { not: null } }, select: { containerName: true } })).map(
      (i) => i.containerName!
    )
  );

  const containers: ContainerOption[] =
    editable && (await resolvedDockerHosts()).length > 0
      ? (await listContainers()).map((c) => ({
          name: c.name,
          hostKey: c.hostKey,
          hostLabel: c.hostLabel,
          state: c.state,
          image: c.image,
          suggestedUrl: c.suggestedUrl,
          icon: c.declared?.icon,
          group: c.declared?.group,
          onDashboard: placed.has(c.name),
        }))
      : [];

  /**
   * Live data for the tiles that were configured to show some.
   *
   * Nobody pays for this unless a tile asked: with no extras switched on the
   * board makes exactly the queries it always did. `listContainers` is one call
   * per host and is already in hand for an admin; statistics are a call per
   * container, so those are fetched only for the tiles that show them.
   */
  const wants = new Map<string, Record<string, unknown>>();
  for (const item of items) {
    if (!item.containerName || !item.hostKey) continue;
    const extras = parseConfig(item.config);
    if (Object.values(extras).some((v) => v === true)) wants.set(`${item.hostKey}/${item.containerName}`, extras);
  }

  const live = new Map<string, TileLive>();
  if (wants.size > 0) {
    const needStats: { id: string; name: string; hostKey: string }[] = [];
    // Statistics come back keyed by name only, so the way back to the tile's
    // host/name key is remembered here rather than guessed there.
    const statKey = new Map<string, string>();

    for (const c of await listContainers()) {
      const key = `${c.hostKey}/${c.name}`;
      const extras = wants.get(key);
      if (!extras) continue;
      live.set(key, { id: c.id, state: c.state, status: c.status, image: c.image, ports: c.ports });
      if (extras.stats === true && c.state === "running") {
        needStats.push({ id: c.id, name: c.name, hostKey: c.hostKey });
        statKey.set(c.name, key);
      }
    }

    for (const s of await statsForContainers(needStats, 12)) {
      const key = statKey.get(s.name);
      const entry = key ? live.get(key) : undefined;
      if (key && entry) live.set(key, { ...entry, cpu: s.cpu, memory: s.memory });
    }
  }

  // Off by default: the pack is fetched from the public internet, and a LAN-only
  // panel should not depend on that.
  const iconPack = await getSetting<boolean>("icons.pack", false);

  const folders = items.filter((i) => i.kind === "folder").map((i) => ({ id: i.id, title: i.title }));

  return (
    <>
      <AutoRefresh seconds={30} />
      <KioskController tabs={dashboards.map((x) => x.slug ?? x.id)} />

      {/* The dashboard's own photo, behind everything. Set per tab, so a
          "home" tab can look like a home and a "servers" tab like a panel. */}
      {active.backgroundUrl && (
        <div
          className="hp-backdrop"
          style={{
            ["--backdrop-image" as string]: `url("${active.backgroundUrl.replace(/"/g, "%22")}")`,
            ["--backdrop-dim" as string]: String(active.backgroundDim),
            ["--backdrop-blur" as string]: `${active.backgroundBlur}px`,
          }}
          aria-hidden
        />
      )}

      <EditModeProvider canEdit={editable}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Tabs
          d={d}
          dashboards={dashboards.map((x) => ({
            id: x.id,
            name: x.name,
            slug: x.slug ?? x.id,
            shared: x.shared,
            mine: x.ownerId === user.id,
          }))}
          activeId={active.id}
          canEdit={editable}
        />

        {editable && (
          <div className="flex items-center gap-2">
            {/* Two hints, because edit mode is two different things: a pointer
                board on a wide screen and a list with arrows on a phone. */}
            <EditHints d={d} />
            <BackgroundButton
              d={d}
              dashboardId={active.id}
              current={{
                backgroundUrl: active.backgroundUrl ?? "",
                backgroundDim: active.backgroundDim,
                backgroundBlur: active.backgroundBlur,
              }}
            />
            <EditToggle d={d} />
            <AddButton d={d} dashboardId={active.id} containers={containers} folders={folders} iconPack={iconPack} />
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState title={d.dashboard.empty} hint={editable ? d.dashboard.emptyHint : undefined} />
      ) : (
        <Board
          d={d}
          layout={items.map(({ id, x, y, w, h }) => ({ id, x, y, w, h }))}
          folderIds={items.filter((i) => i.kind === "folder").map((i) => i.id)}
          lockedIds={items.filter((i) => i.locked).map((i) => i.id)}
        >
          {items.map((item) => (
            <Tile
              key={item.id}
              item={item}
              statuses={statuses}
              d={d}
              canEdit={editable}
              iconPack={iconPack}
              userId={user.id}
              live={item.containerName ? live.get(`${item.hostKey}/${item.containerName}`) : undefined}
            />
          ))}
        </Board>
      )}
      </EditModeProvider>
    </>
  );
}
