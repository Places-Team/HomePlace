"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Card, Badge, Meter } from "@/components/ui";
import { Sparkline } from "@/components/Sparkline";
import { Input, Select, Button, Field } from "@/components/form";
import { Dialog } from "@/components/Dialog";
import { TileIcon } from "@/components/TileIcon";
import { LiveLogs } from "@/components/containers/LiveLogs";
import {
  LogsIcon,
  PlayIcon,
  StopIcon,
  RestartIcon,
  OpenIcon,
  MonitorIcon,
} from "@/components/containers/ControlIcons";
import { GroupCategoryIcon, categoryFor } from "@/components/containers/GroupIcons";
import { runContainerAction, checkImageUpdates, pullContainerImage } from "@/actions/containers";
import { saveContainerGroups } from "@/actions/dashboard";
import { autoIcon, guessIcon, GLYPH } from "@/lib/icons";
import {
  groupContainers,
  type ContainerGroupConfig,
  type CustomGroup,
  type GroupBucket,
} from "@/lib/containerGroups";
import { bytes, percent } from "@/lib/format";
import type { Dictionary } from "@/i18n";

export type Row = {
  /** Recent CPU and memory, for the sparkline in the row. */
  cpuHistory?: [number, number][];
  memoryHistory?: [number, number][];
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  health?: string;
  project?: string;
  hostKey: string;
  hostLabel: string;
  ports: { internal: number; external?: number; protocol: string }[];
  suggestedUrl?: string;
  icon?: string;
  onDashboard: boolean;
  cpu?: number;
  memory?: number;
  memoryLimit?: number;
};

/**
 * The container list as an operations view.
 *
 * The dashboard answers "is my stuff up" with tiles you arranged. This answers
 * a different question — "what is running on this machine right now, what is it
 * costing, and which one is misbehaving" — for containers you never bothered to
 * put on a board.
 *
 * Two things this view carries beyond the flat list:
 *
 *  - **Groups.** Containers fold into the stacks they belong to. Compose
 *    projects become groups automatically; anything can also be grouped by
 *    hand, and either kind is renamed, re-iconed, hidden or deleted here.
 *  - **Logs on the spot.** A button on each row opens the tail without leaving
 *    the page — the last lines are there at once, and keep coming.
 *
 * Searching and sorting happen in the browser: the whole list is already here,
 * and a round-trip per keystroke would make it feel worse, not better.
 */
export function ContainerTable({
  d,
  rows,
  canEdit,
  controlEnabled,
  dashboardId,
  iconPack,
  groups,
  initialUpdates = {},
}: {
  d: Dictionary;
  rows: Row[];
  canEdit: boolean;
  controlEnabled: boolean;
  dashboardId: string | null;
  iconPack: boolean;
  groups: ContainerGroupConfig;
  initialUpdates?: Record<string, "update" | "current" | "unknown">;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "running" | "stopped" | "problems">("all");
  const [host, setHost] = useState<string>("all");
  const [sort, setSort] = useState<"name" | "cpu" | "memory" | "project" | "state" | "host">("name");

  // The distinct hosts, for the host filter — only worth showing on a multi-host
  // setup, where "which machine is this on" is a real question.
  const hosts = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (!seen.has(r.hostKey)) seen.set(r.hostKey, r.hostLabel);
    return [...seen].map(([key, label]) => ({ key, label }));
  }, [rows]);
  const [grouped, setGrouped] = useState(true);
  const [showCharts, setShowCharts] = useState(true);
  const [showCpu, setShowCpu] = useState(true);
  const [showMemory, setShowMemory] = useState(true);
  const [displayOpen, setDisplayOpen] = useState(false);

  // Display choices are a personal preference, not shared state — keep them in
  // the browser so they survive a reload without a round trip.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("hp.containers.display") ?? "{}");
      if (typeof saved.charts === "boolean") setShowCharts(saved.charts);
      if (typeof saved.cpu === "boolean") setShowCpu(saved.cpu);
      if (typeof saved.memory === "boolean") setShowMemory(saved.memory);
    } catch {
      /* nothing saved yet */
    }
  }, []);
  useEffect(() => {
    localStorage.setItem("hp.containers.display", JSON.stringify({ charts: showCharts, cpu: showCpu, memory: showMemory }));
  }, [showCharts, showCpu, showMemory]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updates, setUpdates] = useState<Record<string, "update" | "current" | "unknown">>(initialUpdates);
  const [checking, setChecking] = useState(false);
  const [hintFor, setHintFor] = useState<string | null>(null);

  function checkUpdates() {
    setChecking(true);
    setError(null);
    startTransition(async () => {
      const result = await checkImageUpdates();
      setUpdates(Object.fromEntries(result.map((r) => [r.name, r.status])));
      setChecking(false);
    });
  }
  const [pending, startTransition] = useTransition();

  // The group configuration is edited here and saved back on every change; the
  // page reads the same setting on its next render, so a reload agrees with it.
  const [config, setConfig] = useState<ContainerGroupConfig>(groups);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [logsRow, setLogsRow] = useState<Row | null>(null);
  const [editing, setEditing] = useState<GroupBucket<Row> | null>(null);
  const [creating, setCreating] = useState(false);

  function persist(next: ContainerGroupConfig) {
    setConfig(next);
    startTransition(() => void saveContainerGroups(next));
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const problem = (row: Row) =>
      row.state === "restarting" || row.state === "dead" || row.health === "unhealthy" || row.state === "exited";

    return rows
      .filter((row) => {
        if (host !== "all" && row.hostKey !== host) return false;
        if (filter === "running" && row.state !== "running") return false;
        if (filter === "stopped" && row.state === "running") return false;
        if (filter === "problems" && !problem(row)) return false;
        if (!needle) return true;
        return `${row.name} ${row.image} ${row.project ?? ""} ${row.hostLabel}`.toLowerCase().includes(needle);
      })
      .sort((a, b) => {
        if (sort === "cpu") return (b.cpu ?? -1) - (a.cpu ?? -1);
        if (sort === "memory") return (b.memory ?? -1) - (a.memory ?? -1);
        if (sort === "project") return (a.project ?? "~").localeCompare(b.project ?? "~") || a.name.localeCompare(b.name);
        if (sort === "state") return a.state.localeCompare(b.state) || a.name.localeCompare(b.name);
        if (sort === "host") return a.hostLabel.localeCompare(b.hostLabel) || a.name.localeCompare(b.name);
        return a.name.localeCompare(b.name);
      });
  }, [rows, query, filter, host, sort]);

  const searching = query.trim().length > 0 || filter !== "all" || host !== "all";

  // Grouping is off while searching: a search wants every match in one place,
  // not scattered under headers half of which are then empty.
  const buckets = useMemo(() => {
    if (!grouped || searching) return null;
    return groupContainers(visible, config, d.containers.ungrouped);
  }, [grouped, searching, visible, config, d.containers.ungrouped]);

  // Start/stop/restart go through a confirmation first — a mis-tap on a phone
  // should not silently bounce a service. The pending action is held with a
  // closure that actually runs it once confirmed.
  const [confirm, setConfirm] = useState<{ title: string; label: string; run: () => void; danger?: boolean } | null>(null);
  const [pulling, setPulling] = useState<string | null>(null);

  function ask(title: string, label: string, run: () => void, danger = false) {
    setConfirm({ title, label, run, danger });
  }

  // Pull the newer image for every container in a group that has an update
  // waiting. Like the row button, this only fetches — nothing is recreated.
  function pullGroup(items: Row[]) {
    const targets = items.filter((r) => updates[r.name] === "update");
    if (targets.length === 0) return;
    setError(null);
    setPulling(items.map((r) => r.id).join(","));
    startTransition(async () => {
      for (const row of targets) {
        const r = await pullContainerImage(row.hostKey, row.image);
        if (!r.ok) setError(`${row.name}: ${r.error ?? d.containers.actionFailed}`);
      }
      setPulling(null);
    });
  }

  function act(row: Row, action: "start" | "stop" | "restart") {
    setBusy(row.id);
    setError(null);
    startTransition(async () => {
      const result = await runContainerAction(row.hostKey, row.id, row.name, action);
      if (!result.ok) setError(`${row.name}: ${result.error ?? d.containers.actionFailed}`);
      setBusy(null);
    });
  }

  /**
   * The same action across a whole group — start the stopped, or stop/restart
   * the running. Only the containers the action can actually change are touched.
   */
  function actGroup(items: Row[], action: "start" | "stop" | "restart") {
    const targets = items.filter((r) => (action === "start" ? r.state !== "running" : r.state === "running"));
    if (targets.length === 0) return;
    setError(null);
    startTransition(async () => {
      for (const row of targets) {
        const result = await runContainerAction(row.hostKey, row.id, row.name, action);
        if (!result.ok) setError(`${row.name}: ${result.error ?? d.containers.actionFailed}`);
      }
    });
  }

  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function setAllCollapsed(all: boolean) {
    if (!buckets) return;
    setCollapsed(all ? new Set(buckets.map((b) => b.key)) : new Set());
  }

  function renderRow(row: Row) {
    const running = row.state === "running";
    const icon = row.icon || autoIcon({ name: row.name, image: row.image, pack: iconPack });
    const memoryPercent = row.memory && row.memoryLimit ? (row.memory / row.memoryLimit) * 100 : null;

    return (
      <li key={`${row.hostKey}/${row.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            row.health === "unhealthy" || row.state === "restarting"
              ? "bg-warn"
              : running
                ? "bg-ok"
                : "bg-faint"
          }`}
          title={row.status}
          aria-hidden
        />
        {/* Straight to this container's monitoring — right beside the status
            dot, the same weight as the row's other line icons. */}
        <Link
          href={`/containers/${encodeURIComponent(row.hostKey)}/${encodeURIComponent(row.id)}`}
          title={d.nav.monitoring}
          className="inline-flex shrink-0 items-center rounded-control p-0.5 text-faint transition-colors hover:bg-raised hover:text-text"
        >
          <MonitorIcon />
        </Link>
        <TileIcon icon={icon} title={row.name} size="sm" fallback={guessIcon({ name: row.name, image: row.image }) || GLYPH.container} />

        <div className="min-w-[10rem] flex-1">
          <div className="flex items-center gap-1.5">
            <Link
              href={`/containers/${encodeURIComponent(row.hostKey)}/${encodeURIComponent(row.id)}`}
              className="truncate text-sm font-medium hover:text-accent"
            >
              {row.name}
            </Link>
            {row.onDashboard && <span className="text-[10px] text-faint" title={d.containers.onDashboard}>◈</span>}
            {updates[row.name] === "update" && (
              <span className="relative inline-flex">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setHintFor((n) => (n === row.name ? null : row.name));
                  }}
                  title={d.containers.updateAvailable}
                  aria-label={d.containers.updateAvailable}
                  className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-warn/15 text-warn transition-colors hover:bg-warn/25"
                >
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                    <path
                      d="M6 9.25V3.4M6 3.4 3.4 6M6 3.4 8.6 6"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                {hintFor === row.name && (
                  <UpdateHint
                    d={d}
                    hostKey={row.hostKey}
                    image={row.image}
                    canPull={controlEnabled}
                    onClose={() => setHintFor(null)}
                  />
                )}
              </span>
            )}
          </div>
          <p className="truncate font-mono text-[11px] text-faint" title={row.image}>
            {row.status}
          </p>
        </div>

        {row.project && (
          <span className="hidden shrink-0 sm:inline">
            <Badge>{row.project}</Badge>
          </span>
        )}

        {showCpu && (
          <div className="w-24 shrink-0">
            {running && row.cpu !== undefined ? (
              <>
                <p className="text-right font-mono text-[11px] tabular-nums">{percent(row.cpu, 1)}</p>
                {showCharts && row.cpuHistory && row.cpuHistory.length > 2 ? (
                  <span className="block h-5 [&_svg]:h-5">
                    <Sparkline points={row.cpuHistory} min={0} height={20} />
                  </span>
                ) : (
                  <Meter value={Math.min(100, row.cpu)} />
                )}
              </>
            ) : (
              <span className="block text-right text-[11px] text-faint">—</span>
            )}
          </div>
        )}

        {showMemory && (
          <div className="w-28 shrink-0">
            {running && row.memory !== undefined ? (
              <>
                <p className="text-right font-mono text-[11px] tabular-nums">{bytes(row.memory)}</p>
                {showCharts && row.memoryHistory && row.memoryHistory.length > 2 ? (
                  <span className="block h-5 [&_svg]:h-5">
                    <Sparkline points={row.memoryHistory} tone="ok" height={20} />
                  </span>
                ) : (
                  memoryPercent !== null && <Meter value={memoryPercent} />
                )}
              </>
            ) : (
              <span className="block text-right text-[11px] text-faint">—</span>
            )}
          </div>
        )}

        <div className="flex shrink-0 items-center gap-0.5">
          <Button size="sm" variant="quiet" title={d.containers.viewLogs} onClick={() => setLogsRow(row)}>
            <LogsIcon />
          </Button>

          {row.suggestedUrl && (
            <a
              href={row.suggestedUrl.replace("HOST_ADDRESS", typeof window === "undefined" ? "" : window.location.hostname)}
              target="_blank"
              rel="noreferrer"
              title={d.containers.open}
              className="inline-flex items-center rounded-control px-2 py-1 text-muted transition-colors hover:bg-raised hover:text-text"
            >
              <OpenIcon />
            </a>
          )}

          {canEdit && controlEnabled && (
            <Button
              size="sm"
              variant="quiet"
              disabled={pending && busy === row.id}
              onClick={() =>
                ask(running ? d.containers.restart : d.containers.start, row.name, () =>
                  act(row, running ? "restart" : "start")
                )
              }
              title={running ? d.containers.restart : d.containers.start}
            >
              {running ? <RestartIcon /> : <PlayIcon />}
            </Button>
          )}
          {canEdit && controlEnabled && running && (
            <Button size="sm" variant="quiet" disabled={pending && busy === row.id} onClick={() => ask(d.containers.stop, row.name, () => act(row, "stop"), true)} title={d.containers.stop}>
              <StopIcon />
            </Button>
          )}
        </div>
      </li>
    );
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`${d.common.search} · ${rows.length}`}
          aria-label={d.common.search}
          className="!w-full min-w-0 sm:!w-auto sm:min-w-[12rem] sm:flex-1"
        />
        <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label={d.containers.filterAll} className="!w-full sm:!w-40">
          <option value="all">{d.containers.filterAll}</option>
          <option value="running">{d.status.running}</option>
          <option value="stopped">{d.status.stopped}</option>
          <option value="problems">{d.containers.filterProblems}</option>
        </Select>
        {hosts.length > 1 && (
          <Select value={host} onChange={(e) => setHost(e.target.value)} aria-label={d.containers.allHosts} className="!w-full sm:!w-40">
            <option value="all">{d.containers.allHosts}</option>
            {hosts.map((h) => (
              <option key={h.key} value={h.key}>
                {h.label}
              </option>
            ))}
          </Select>
        )}
        <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label={d.containers.sortName} className="!w-full sm:!w-40">
          <option value="name">{d.containers.sortName}</option>
          <option value="project">{d.containers.sortProject}</option>
          <option value="state">{d.containers.sortState}</option>
          {hosts.length > 1 && <option value="host">{d.containers.sortHost}</option>}
          <option value="cpu">{d.monitoring.cpu}</option>
          <option value="memory">{d.monitoring.memory}</option>
        </Select>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {canEdit && (
            <Button size="sm" variant="quiet" disabled={checking} onClick={checkUpdates} title={d.containers.checkUpdatesHint}>
              {checking ? d.common.loading : d.containers.checkUpdates}
            </Button>
          )}
          <div className="relative">
            <Button size="sm" variant="quiet" onClick={() => setDisplayOpen((v) => !v)} title={d.containers.display}>
              ⚙
            </Button>
            {displayOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setDisplayOpen(false)} aria-hidden />
                <div className="absolute right-0 z-20 mt-1 w-44 rounded-control border border-line bg-surface p-2 shadow-pop">
                  <p className="mb-1 px-1 text-[11px] font-medium text-muted">{d.containers.display}</p>
                  {(
                    [
                      [d.containers.colCharts, showCharts, setShowCharts],
                      [d.monitoring.cpu, showCpu, setShowCpu],
                      [d.monitoring.memory, showMemory, setShowMemory],
                    ] as [string, boolean, (v: (p: boolean) => boolean) => void][]
                  ).map(([label, on, set]) => (
                    <label key={label} className="flex items-center gap-2 rounded-control px-1 py-1 text-sm hover:bg-raised">
                      <input type="checkbox" checked={on} onChange={() => set((p) => !p)} />
                      {label}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
          <Button
            size="sm"
            variant={grouped ? "ghost" : "quiet"}
            onClick={() => setGrouped((v) => !v)}
            title={grouped ? d.containers.flat : d.containers.grouped}
          >
            {grouped ? d.containers.grouped : d.containers.flat}
          </Button>
          {grouped && !searching && buckets && buckets.length > 1 && (
            <Button
              size="sm"
              variant="quiet"
              onClick={() => setAllCollapsed(collapsed.size < buckets.length)}
            >
              {collapsed.size < buckets.length ? d.containers.collapseAll : d.containers.expandAll}
            </Button>
          )}
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
              ＋ {d.containers.newGroup}
            </Button>
          )}
        </div>
      </div>

      {error && <p className="mb-2 text-xs text-danger">{error}</p>}

      {/* Flat list — used when searching, filtering, or when grouping is off. */}
      {!buckets && (
        <Card>
          <ul className="divide-y divide-line">
            {visible.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">{d.events.noMatches}</li>}
            {visible.map(renderRow)}
          </ul>
        </Card>
      )}

      {/* Grouped view — two columns on a wide screen so the stacks fill the
          width instead of leaving a channel of empty space down the middle.
          Columns rather than a grid: the groups are different heights, and a
          grid would leave a ragged gap under the shorter one. */}
      {buckets && (
        <div className="gap-3 [column-fill:balance] sm:columns-1 lg:columns-2">
          {buckets.map((bucket) => {
            const isCollapsed = collapsed.has(bucket.key) || (bucket.hidden && !collapsed.has(`show:${bucket.key}`));
            const runningCount = bucket.items.filter((r) => r.state === "running").length;
            // An empty custom group is worth keeping visible so it can be
            // filled; an empty auto group cannot occur.
            if (bucket.items.length === 0 && bucket.customId === undefined) return null;

            return (
              <Card key={bucket.key} className={`mb-3 break-inside-avoid ${bucket.hidden ? "opacity-70" : ""}`}>
                <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                  <button
                    type="button"
                    onClick={() => toggleCollapse(bucket.key)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span className={`text-faint transition-transform ${isCollapsed ? "" : "rotate-90"}`}>▸</span>
                    {bucket.icon ? (
                      <TileIcon icon={bucket.icon} title={bucket.name} size="sm" />
                    ) : (
                      bucket.key !== "ungrouped" && (
                        <span className="shrink-0 text-muted">
                          <GroupCategoryIcon
                            category={categoryFor(
                              `${bucket.name} ${bucket.projectKey ?? ""} ${bucket.items.map((r) => `${r.name} ${r.image}`).join(" ")}`
                            )}
                            className="h-4 w-4"
                          />
                        </span>
                      )
                    )}
                    <span className="truncate text-sm font-semibold">{bucket.name}</span>
                    {bucket.auto && <Badge>{d.containers.autoGroup}</Badge>}
                    <span className="font-mono text-[11px] text-faint">
                      {runningCount}/{bucket.items.length}
                    </span>
                  </button>

                  <div className="flex shrink-0 items-center gap-0.5">
                    {/* Whole-group controls: restart or stop the running ones,
                        start the stopped ones — the group in one press. */}
                    {canEdit && controlEnabled && bucket.items.length > 0 && (
                      <>
                        <Button size="sm" variant="quiet" title={d.containers.startGroup} onClick={() => ask(d.containers.startGroup, `${bucket.name} · ${bucket.items.length}`, () => actGroup(bucket.items, "start"))}>
                          <PlayIcon />
                        </Button>
                        <Button size="sm" variant="quiet" title={d.containers.restartGroup} onClick={() => ask(d.containers.restartGroup, `${bucket.name} · ${bucket.items.length}`, () => actGroup(bucket.items, "restart"))}>
                          <RestartIcon />
                        </Button>
                        <Button size="sm" variant="quiet" title={d.containers.stopGroup} onClick={() => ask(d.containers.stopGroup, `${bucket.name} · ${bucket.items.length}`, () => actGroup(bucket.items, "stop"), true)}>
                          <StopIcon />
                        </Button>
                        {/* Only when the group actually has updates waiting: pull
                            the new image for each, in one press. */}
                        {bucket.items.some((r) => updates[r.name] === "update") && (
                          <Button
                            size="sm"
                            variant="quiet"
                            disabled={pulling !== null}
                            title={d.containers.updateGroup}
                            onClick={() =>
                              ask(
                                d.containers.updateGroup,
                                `${bucket.name} · ${bucket.items.filter((r) => updates[r.name] === "update").length}`,
                                () => pullGroup(bucket.items)
                              )
                            }
                          >
                            <span className="text-warn" aria-hidden>
                              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                                <path d="M8 10.5V4M8 4 5 7M8 4l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M4 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                              </svg>
                            </span>
                          </Button>
                        )}
                      </>
                    )}
                    {canEdit && bucket.key !== "ungrouped" && (
                      <Button size="sm" variant="quiet" title={d.common.edit} onClick={() => setEditing(bucket)}>
                        ✎
                      </Button>
                    )}
                  </div>
                </div>

                {!isCollapsed && (
                  <ul className="divide-y divide-line">
                    {bucket.items.length === 0 ? (
                      <li className="px-4 py-4 text-center text-xs text-muted">{d.containers.groupMembersHint}</li>
                    ) : (
                      bucket.items.map(renderRow)
                    )}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Logs, on the spot. */}
      <Dialog open={logsRow !== null} onClose={() => setLogsRow(null)} title={logsRow?.name ?? d.containers.logs} wide>
        {logsRow && (
          <LiveLogs
            d={d}
            hostKey={logsRow.hostKey}
            id={logsRow.id}
            name={logsRow.name}
            initial=""
            tail={200}
            className="max-h-[55vh]"
          />
        )}
      </Dialog>

      {/* Create / edit a group. */}
      {creating && (
        <GroupDialog
          d={d}
          rows={rows}
          config={config}
          bucket={null}
          onClose={() => setCreating(false)}
          onSave={(next) => {
            persist(next);
            setCreating(false);
          }}
        />
      )}
      {editing && (
        <GroupDialog
          d={d}
          rows={rows}
          config={config}
          bucket={editing}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            persist(next);
            setEditing(null);
          }}
        />
      )}

      {confirm && (
        <Dialog open onClose={() => setConfirm(null)} title={confirm.title}>
          <div className="p-4">
            <p className="text-sm text-muted">{d.containers.confirmAction}</p>
            <p className="mt-1 truncate font-medium">{confirm.label}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="quiet" onClick={() => setConfirm(null)}>
                {d.common.cancel}
              </Button>
              <Button
                variant={confirm.danger ? "danger" : "primary"}
                onClick={() => {
                  confirm.run();
                  setConfirm(null);
                }}
              >
                {confirm.title}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}

/**
 * One dialog for both making and editing a group.
 *
 * A custom group owns its member list; an automatic group owns nothing but an
 * override — a new name, icon and a hidden flag layered over the Compose
 * project — so the member picker only appears for the kind that has members to
 * pick. Everything is returned as a whole new config object the caller saves.
 */
function GroupDialog({
  d,
  rows,
  config,
  bucket,
  onClose,
  onSave,
}: {
  d: Dictionary;
  rows: Row[];
  config: ContainerGroupConfig;
  /** null → creating a new custom group. */
  bucket: GroupBucket<Row> | null;
  onClose: () => void;
  onSave: (next: ContainerGroupConfig) => void;
}) {
  const isAuto = bucket?.auto ?? false;
  const existingCustom = bucket?.customId
    ? config.custom.find((g) => g.id === bucket.customId)
    : undefined;

  const [name, setName] = useState(bucket?.name ?? "");
  const [icon, setIcon] = useState(bucket?.icon ?? "");
  const [members, setMembers] = useState<string[]>(existingCustom?.members ?? []);
  // Extra containers pulled into an automatic group by hand.
  const [extra, setExtra] = useState<string[]>(
    isAuto && bucket?.projectKey ? config.overrides[bucket.projectKey]?.extra ?? [] : []
  );

  const allNames = useMemo(() => [...rows].sort((a, b) => a.name.localeCompare(b.name)), [rows]);

  // Containers Compose already put in this automatic group — shown ticked and
  // fixed, since they belong here whatever the override says.
  const naturalHere = useMemo(
    () => new Set(rows.filter((r) => isAuto && bucket?.projectKey && r.project === bucket.projectKey).map((r) => r.name)),
    [rows, isAuto, bucket?.projectKey]
  );
  // Names already spoken for by another custom group, so a container cannot be
  // claimed by two at once.
  const takenElsewhere = useMemo(() => {
    const set = new Set<string>();
    for (const g of config.custom) {
      if (g.id === existingCustom?.id) continue;
      for (const m of g.members) set.add(m);
    }
    return set;
  }, [config.custom, existingCustom?.id]);

  function toggleMember(n: string) {
    setMembers((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]));
  }

  function toggleExtra(n: string) {
    setExtra((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]));
  }

  function save() {
    if (isAuto && bucket?.projectKey) {
      const overrides = { ...config.overrides };
      overrides[bucket.projectKey] = {
        ...overrides[bucket.projectKey],
        name: name.trim() || undefined,
        icon: icon.trim() || undefined,
        // Never store a container that already belongs here by Compose.
        extra: extra.filter((n) => !naturalHere.has(n)),
      };
      onSave({ ...config, overrides });
      return;
    }
    // Custom group — create or update.
    const trimmed = name.trim();
    if (!trimmed) return;
    if (existingCustom) {
      const custom = config.custom.map((g) =>
        g.id === existingCustom.id ? { ...g, name: trimmed, icon: icon.trim() || undefined, members } : g
      );
      onSave({ ...config, custom });
    } else {
      const group: CustomGroup = {
        id: `g${Date.now().toString(36)}`,
        name: trimmed,
        icon: icon.trim() || undefined,
        members,
      };
      onSave({ ...config, custom: [...config.custom, group] });
    }
  }

  function toggleHidden() {
    if (!isAuto || !bucket?.projectKey) return;
    const overrides = { ...config.overrides };
    const cur = overrides[bucket.projectKey] ?? {};
    overrides[bucket.projectKey] = { ...cur, hidden: !cur.hidden };
    onSave({ ...config, overrides });
  }

  function remove() {
    if (existingCustom) {
      onSave({ ...config, custom: config.custom.filter((g) => g.id !== existingCustom.id) });
    }
  }

  return (
    <Dialog open onClose={onClose} title={bucket ? d.containers.editGroup : d.containers.newGroup} wide>
      <div className="space-y-4">
        <Field label={d.containers.groupName}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={bucket?.projectKey ?? ""} />
        </Field>
        <Field label={d.containers.groupIcon} hint={isAuto ? d.containers.autoGroupHint : undefined}>
          <Input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="🧩" />
        </Field>

        {!isAuto && (
          <Field label={d.containers.groupMembers} hint={d.containers.groupMembersHint}>
            <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-control border border-line p-1">
              {allNames.map((r) => {
                const taken = takenElsewhere.has(r.name);
                return (
                  <label
                    key={`${r.hostKey}/${r.id}`}
                    className={`flex items-center gap-2 rounded-control px-2 py-1 text-sm ${
                      taken ? "opacity-40" : "hover:bg-raised"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={members.includes(r.name)}
                      disabled={taken}
                      onChange={() => toggleMember(r.name)}
                    />
                    <span className="truncate">{r.name}</span>
                    {r.project && <span className="ml-auto font-mono text-[11px] text-faint">{r.project}</span>}
                  </label>
                );
              })}
            </div>
          </Field>
        )}

        {/* Automatic group: its Compose members are fixed, but you can pull in
            your own containers — the ones Compose did not put here. */}
        {isAuto && (
          <Field label={d.containers.groupMembers} hint={d.containers.groupMembersHint}>
            <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-control border border-line p-1">
              {allNames.map((r) => {
                const natural = naturalHere.has(r.name);
                const takenByCustom = takenElsewhere.has(r.name);
                const checked = natural || extra.includes(r.name);
                return (
                  <label
                    key={`${r.hostKey}/${r.id}`}
                    className={`flex items-center gap-2 rounded-control px-2 py-1 text-sm ${
                      natural || takenByCustom ? "opacity-50" : "hover:bg-raised"
                    }`}
                    title={natural ? d.containers.autoGroupHint : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={natural || takenByCustom}
                      onChange={() => toggleExtra(r.name)}
                    />
                    <span className="truncate">{r.name}</span>
                    {r.project && <span className="ml-auto font-mono text-[11px] text-faint">{r.project}</span>}
                  </label>
                );
              })}
            </div>
          </Field>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2">
            {isAuto && (
              <Button variant="quiet" onClick={toggleHidden}>
                {bucket?.hidden ? d.containers.unhideGroup : d.containers.hideGroup}
              </Button>
            )}
            {existingCustom && (
              <Button variant="danger" onClick={remove}>
                {d.containers.deleteGroup}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="quiet" onClick={onClose}>
              {d.common.cancel}
            </Button>
            <Button variant="primary" onClick={save}>
              {d.common.save}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * The "how to update" popover behind the update dot.
 *
 * The panel talks to Docker only through the read-mostly socket proxy — it
 * cannot pull an image or safely rebuild a Compose-managed container from here
 * without risking the very config Compose owns. So the honest one click is: show
 * exactly what to run, ready to copy, rather than pretend to do it and drift the
 * stack.
 */
function UpdateHint({
  d,
  hostKey,
  image,
  canPull,
  onClose,
}: {
  d: Dictionary;
  hostKey: string;
  image: string;
  canPull: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pulled, setPulled] = useState<{ ok: boolean; error?: string } | null>(null);
  const cmd = `docker pull ${image}`;

  async function pull() {
    setPulling(true);
    setPulled(null);
    try {
      setPulled(await pullContainerImage(hostKey, image));
    } catch (e) {
      setPulled({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setPulling(false);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        className="fixed inset-0 z-10 cursor-default"
        onClick={onClose}
      />
      <div className="absolute left-0 top-6 z-20 w-72 max-w-[calc(100vw-2rem)] rounded-card border border-line bg-surface p-3 text-left shadow-pop">
        <p className="text-sm font-semibold text-warn">{d.containers.updateAvailable}</p>

        {/* One safe click: pull the new image. The container keeps running the
            old one until Compose recreates it — said plainly on success. */}
        {canPull && (
          <>
            <button
              type="button"
              onClick={pull}
              disabled={pulling}
              className="mt-2 w-full rounded-control bg-warn/15 px-2.5 py-1.5 text-xs font-semibold text-warn transition-colors hover:bg-warn/25 disabled:opacity-60"
            >
              {pulling ? `${d.common.loading}…` : d.containers.pullImage}
            </button>
            {pulled &&
              (pulled.ok ? (
                <p className="mt-1.5 text-[11px] text-ok">{d.containers.pullDone}</p>
              ) : (
                <p className="mt-1.5 break-words text-[11px] text-danger">{pulled.error}</p>
              ))}
          </>
        )}

        <p className="mt-2 text-xs text-muted">{d.containers.updateHowTo}</p>
        <div className="mt-1.5 flex items-center gap-2 rounded-control border border-line bg-raised px-2 py-1.5">
          <code className="min-w-0 flex-1 truncate font-mono text-[11px]">{cmd}</code>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(cmd);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="shrink-0 text-[11px] text-muted transition-colors hover:text-text"
          >
            {copied ? d.common.copied : d.common.copy}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-faint">{d.containers.updateComposeNote}</p>
      </div>
    </>
  );
}
