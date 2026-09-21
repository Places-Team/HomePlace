"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  addWatchEntry,
  cancelMediaRequest,
  manageDownload,
  readJellyfinDetails,
  readMediaAutomationTasks,
  readMediaDetails,
  readMediaServiceIssues,
  requestMedia,
  searchMedia,
} from "@/actions/media";
import type { Dictionary } from "@/i18n";
import type {
  DownloadItem,
  JellyfinDetails,
  JellyfinLibraryItem,
  JellyfinProfile,
  MediaCard,
  MediaAutomationTask,
  MediaDetailsData,
  MediaQualityProfile,
  MediaRequest,
  MediaServiceIssue,
} from "@/lib/media";
import { Badge, EmptyState, Meter } from "@/components/ui";
import { Button, Input, Select } from "@/components/form";
import { Dialog } from "@/components/Dialog";
import { serviceLogo } from "@/lib/icons";
import {
  isHomeNetworkHost,
  jellyfinNativeLink,
  jellyfinWebBase,
  jellyfinWebLink,
} from "@/lib/jellyfinLinks";
import type { WatchEntryView } from "@/lib/watchHistory";
import { WatchJournal } from "./WatchJournal";

type Tab =
  | "discover"
  | "library"
  | "history"
  | "requests"
  | "downloads"
  | "health";
type DiscoverResult = {
  configured: boolean;
  page: number;
  pages: number;
  items: MediaCard[];
};
type MediaDictionary = Dictionary & {
  media: Dictionary["mediaCenter"] & Dictionary["media"];
};

const statusTone = (status: MediaCard["status"]) =>
  status === "available"
    ? "ok"
    : status === "pending"
      ? "warn"
      : status === "requested" || status === "partially-available"
        ? "accent"
        : "neutral";

const speed = (bytes: number) =>
  bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MiB/s`
    : `${Math.round(bytes / 1024)} KiB/s`;
const size = (bytes: number) =>
  bytes > 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GiB`
    : `${(bytes / 1024 ** 2).toFixed(0)} MiB`;
const eta = (seconds: number) =>
  !Number.isFinite(seconds) || seconds > 8640000
    ? "—"
    : seconds > 3600
      ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
      : `${Math.ceil(seconds / 60)}m`;
const mediaKey = (value: string) =>
  value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const matchingDownload = (title: string, items: DownloadItem[]) => {
  const key = mediaKey(title);
  return (
    items.find(
      (item) =>
        mediaKey(item.name).includes(key) || key.includes(mediaKey(item.name)),
    ) ?? null
  );
};

export function MediaLibrary({
  d: dictionary,
  initialDiscover,
  library,
  requests: initialRequests,
  downloads: initialDownloads,
  initialHistory,
  jellyfinProfiles,
  initialServiceIssues,
  initialAutomationTasks,
  jellyfinUserId,
  jellyfin,
  canManage,
}: {
  d: Dictionary;
  initialDiscover: DiscoverResult;
  library: { configured: boolean; items: JellyfinLibraryItem[] };
  requests: MediaRequest[];
  downloads: { configured: boolean; items: DownloadItem[] };
  initialHistory: WatchEntryView[];
  jellyfinProfiles: JellyfinProfile[];
  initialServiceIssues: MediaServiceIssue[];
  initialAutomationTasks: MediaAutomationTask[];
  jellyfinUserId: string;
  jellyfin: { url: string; localUrl: string; appUrl: string };
  canManage: boolean;
}) {
  // The existing `media` dictionary belongs to the Home Assistant player
  // widget. Keep that API stable while this workspace uses its own vocabulary.
  const d = { ...dictionary, media: dictionary.mediaCenter } as MediaDictionary;
  const [tab, setTab] = useState<Tab>("discover");
  const [result, setResult] = useState(initialDiscover);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "movie" | "tv">("all");
  const [year, setYear] = useState("");
  const [rating, setRating] = useState("0");
  const [availability, setAvailability] = useState("all");
  const [sort, setSort] = useState("popularity");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<MediaCard | null>(null);
  const [selectedDetails, setSelectedDetails] =
    useState<MediaDetailsData | null>(null);
  const [selectedProfiles, setSelectedProfiles] = useState<
    MediaQualityProfile[]
  >([]);
  const [selectedDetailsError, setSelectedDetailsError] = useState("");
  const [librarySelected, setLibrarySelected] =
    useState<JellyfinLibraryItem | null>(null);
  const [libraryDetails, setLibraryDetails] = useState<JellyfinDetails | null>(
    null,
  );
  const [libraryDetailsError, setLibraryDetailsError] = useState("");
  const [requests, setRequests] = useState(initialRequests);
  const [downloads, setDownloads] = useState(initialDownloads.items);
  const [history, setHistory] = useState(initialHistory);
  const [serviceIssues, setServiceIssues] = useState(initialServiceIssues);
  const [automationTasks, setAutomationTasks] = useState(
    initialAutomationTasks,
  );
  const [refreshingIssues, setRefreshingIssues] = useState(false);
  const [showAllServiceIssues, setShowAllServiceIssues] = useState(false);
  const [preferLocal, setPreferLocal] = useState(false);
  const [lanDetected, setLanDetected] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [watchFilter, setWatchFilter] = useState<
    "all" | "unwatched" | "progress" | "played"
  >("all");
  const [librarySort, setLibrarySort] = useState<
    "recent" | "title" | "year" | "progress"
  >("recent");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const detected = isHomeNetworkHost(window.location.hostname);
    setLanDetected(detected);
    const saved = window.localStorage.getItem("homeplace:jellyfin-local");
    setPreferLocal(saved === null ? detected : saved === "1");
  }, []);

  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      const issues = await readMediaServiceIssues();
      if (!stopped) setServiceIssues(issues);
    };
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (tab !== "requests" && tab !== "downloads") return;
    let stopped = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      const tasks = await readMediaAutomationTasks();
      if (!stopped) setAutomationTasks(tasks);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 20_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [tab]);

  function refreshServiceHealth() {
    setRefreshingIssues(true);
    void readMediaServiceIssues()
      .then(setServiceIssues)
      .finally(() => setRefreshingIssues(false));
  }

  const filtered = useMemo(() => {
    const minRating = Number(rating) || 0;
    const wantedYear = Number(year) || 0;
    return result.items
      .filter((item) => !wantedYear || item.year === wantedYear)
      .filter((item) => (item.rating ?? 0) >= minRating)
      .filter((item) => availability === "all" || item.status === availability)
      .sort((a, b) => {
        if (sort === "rating") return (b.rating ?? 0) - (a.rating ?? 0);
        if (sort === "year") return (b.year ?? 0) - (a.year ?? 0);
        if (sort === "title") return a.title.localeCompare(b.title);
        return (b.popularity ?? 0) - (a.popularity ?? 0);
      });
  }, [availability, rating, result.items, sort, year]);

  const libraryItems = useMemo(() => {
    const needle = libraryQuery.trim().toLocaleLowerCase();
    return library.items
      .filter((item) => kind === "all" || item.kind === kind)
      .filter(
        (item) => !needle || item.title.toLocaleLowerCase().includes(needle),
      )
      .filter((item) => {
        if (watchFilter === "played") return item.played;
        if (watchFilter === "progress")
          return !item.played && item.progress > 0;
        if (watchFilter === "unwatched")
          return !item.played && item.progress <= 0;
        return true;
      })
      .sort((a, b) => {
        if (librarySort === "title") return a.title.localeCompare(b.title);
        if (librarySort === "year") return (b.year ?? 0) - (a.year ?? 0);
        if (librarySort === "progress") return b.progress - a.progress;
        return 0;
      });
  }, [kind, library.items, libraryQuery, librarySort, watchFilter]);

  const libraryCounts = useMemo(
    () => ({
      all: library.items.length,
      movie: library.items.filter((item) => item.kind === "movie").length,
      tv: library.items.filter((item) => item.kind === "tv").length,
    }),
    [library.items],
  );

  function runSearch(nextPage = 1, append = false) {
    setMessage("");
    startTransition(async () => {
      const next = await searchMedia({ query, kind, page: nextPage });
      setResult(
        append ? { ...next, items: [...result.items, ...next.items] } : next,
      );
    });
  }

  function selectKind(nextKind: typeof kind) {
    setKind(nextKind);
    if (tab !== "discover") return;
    setMessage("");
    startTransition(async () =>
      setResult(await searchMedia({ query, kind: nextKind })),
    );
  }

  function sendRequest(
    item: MediaCard,
    options: {
      is4k: boolean;
      seasons?: number[];
      serverId?: number;
      profileId?: number;
      rootFolder?: string;
    },
  ) {
    startTransition(async () => {
      const response = await requestMedia({
        kind: item.kind,
        mediaId: item.id,
        ...options,
      });
      setMessage(
        response.ok ? d.media.requestSent : (response.error ?? d.common.failed),
      );
      if (response.ok) {
        if ("requests" in response && response.requests)
          setRequests(response.requests);
        setResult((current) => ({
          ...current,
          items: current.items.map((entry) =>
            entry.id === item.id ? { ...entry, status: "requested" } : entry,
          ),
        }));
        setSelected(null);
        setSelectedDetails(null);
        setTab("requests");
      }
    });
  }

  function openDiscoverDetails(item: MediaCard) {
    setSelected(item);
    setSelectedDetails(null);
    setSelectedProfiles([]);
    setSelectedDetailsError("");
    startTransition(async () => {
      const response = await readMediaDetails(item.kind, item.id);
      if (response.ok && response.details) {
        setSelectedDetails(response.details);
        setSelectedProfiles(response.profiles ?? []);
      } else setSelectedDetailsError(response.error ?? d.common.failed);
    });
  }

  function openLibraryDetails(item: JellyfinLibraryItem) {
    setLibrarySelected(item);
    setLibraryDetails(null);
    setLibraryDetailsError("");
    startTransition(async () => {
      const response = await readJellyfinDetails(item.id);
      if (response.ok && response.details) setLibraryDetails(response.details);
      else setLibraryDetailsError(response.error ?? d.common.failed);
    });
  }

  function addToHistory(item: JellyfinLibraryItem) {
    startTransition(async () => {
      const response = await addWatchEntry({
        jellyfinId: item.id,
        kind: item.kind,
        title: item.title,
        year: item.year,
        poster: item.poster,
        watchedAt: new Date().toISOString(),
      });
      if (response.ok && response.entry) {
        setHistory((current) => [
          response.entry!,
          ...current.filter((entry) => entry.id !== response.entry!.id),
        ]);
        setMessage(d.media.addedToHistory);
      } else setMessage(response.error ?? d.common.failed);
    });
  }

  const webBase = jellyfinWebBase({
    publicUrl: jellyfin.url,
    localUrl: jellyfin.localUrl,
    preferLocal,
  });
  const webLink = (id: string) => jellyfinWebLink(webBase, id);

  function openApp(id: string) {
    const native = jellyfinNativeLink(jellyfin.appUrl, id);
    if (!native)
      return void window.open(webLink(id), "_blank", "noopener,noreferrer");
    let hidden = false;
    const visibility = () => {
      hidden ||= document.hidden;
    };
    document.addEventListener("visibilitychange", visibility, { once: true });
    const launcher = document.createElement("a");
    launcher.href = native;
    launcher.click();
    window.setTimeout(() => {
      document.removeEventListener("visibilitychange", visibility);
      if (!hidden && document.visibilityState === "visible")
        window.open(webLink(id), "_blank", "noopener,noreferrer");
    }, 1300);
  }

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "discover", label: d.media.discover },
    { key: "library", label: d.media.library, count: library.items.length },
    { key: "history", label: d.media.watchHistory, count: history.length },
    {
      key: "requests",
      label: d.media.requests,
      count: requests.length + automationTasks.length,
    },
    { key: "downloads", label: d.media.downloads, count: downloads.length },
    {
      key: "health",
      label: d.media.serviceHealth,
      count: serviceIssues.length,
    },
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={serviceLogo("jellyfin")}
            alt=""
            className="h-11 w-11 rounded-xl object-contain"
          />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {d.media.title}
            </h1>
            <p className="text-sm text-muted">{d.media.subtitle}</p>
          </div>
        </div>
        {jellyfin.localUrl && (
          <label className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={preferLocal}
              onChange={(event) => {
                setPreferLocal(event.target.checked);
                localStorage.setItem(
                  "homeplace:jellyfin-local",
                  event.target.checked ? "1" : "0",
                );
              }}
            />
            {d.media.preferLocal}
            {(preferLocal || lanDetected) && (
              <span
                className="h-1.5 w-1.5 rounded-full bg-ok"
                title={d.media.localActive}
              />
            )}
          </label>
        )}
      </header>

      <nav
        className="flex gap-1 overflow-x-auto border-b border-line"
        aria-label={d.media.title}
      >
        {tabs.map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${tab === item.key ? "border-accent text-text" : "border-transparent text-muted hover:text-text"}`}
          >
            {item.label}
            {item.count !== undefined && (
              <span className="ml-2 rounded-full bg-raised px-1.5 py-0.5 text-[10px]">
                {item.count}
              </span>
            )}
          </button>
        ))}
      </nav>

      {tab === "health" && (
        <ServiceIssuesPanel
          d={d}
          issues={serviceIssues}
          expanded={showAllServiceIssues}
          refreshing={refreshingIssues}
          onRefresh={refreshServiceHealth}
          onToggle={() => setShowAllServiceIssues((value) => !value)}
        />
      )}

      {(tab === "discover" || tab === "library") && (
        <nav
          className="grid grid-cols-3 gap-2 sm:flex"
          aria-label={d.media.contentType}
        >
          {(
            [
              { key: "all", label: d.media.all },
              { key: "movie", label: d.media.movies },
              { key: "tv", label: d.media.series },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={kind === item.key}
              disabled={pending}
              onClick={() => selectKind(item.key)}
              className={`flex min-w-0 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition ${kind === item.key ? "border-accent bg-accent/10 text-accent shadow-sm" : "border-line bg-surface text-muted hover:border-accent/50 hover:text-text"}`}
            >
              <span aria-hidden>
                {item.key === "all" ? "◈" : item.key === "movie" ? "▶" : "▣"}
              </span>
              <span className="truncate">{item.label}</span>
              {tab === "library" && (
                <span className="rounded-full bg-raised px-1.5 py-0.5 text-[10px] text-muted">
                  {libraryCounts[item.key]}
                </span>
              )}
            </button>
          ))}
        </nav>
      )}

      {message && (
        <div
          role="status"
          className="rounded-control border border-line bg-raised px-3 py-2 text-sm"
        >
          {message}
        </div>
      )}

      {tab === "library" && library.configured && (
        <div className="grid gap-2 rounded-card border border-line bg-surface p-3 sm:grid-cols-[minmax(12rem,1fr)_auto_auto]">
          <Input
            value={libraryQuery}
            onChange={(event) => setLibraryQuery(event.target.value)}
            placeholder={d.media.librarySearch}
          />
          <Select
            value={watchFilter}
            onChange={(event) =>
              setWatchFilter(event.target.value as typeof watchFilter)
            }
          >
            <option value="all">{d.media.allWatchStates}</option>
            <option value="unwatched">{d.media.unwatched}</option>
            <option value="progress">{d.media.inProgress}</option>
            <option value="played">{d.media.markPlayed}</option>
          </Select>
          <Select
            value={librarySort}
            onChange={(event) =>
              setLibrarySort(event.target.value as typeof librarySort)
            }
          >
            <option value="recent">{d.media.recentlyAdded}</option>
            <option value="title">A–Z</option>
            <option value="year">{d.media.year}</option>
            <option value="progress">{d.media.watchProgress}</option>
          </Select>
        </div>
      )}

      {tab === "discover" && (
        <section className="space-y-4">
          {!result.configured ? (
            <EmptyState title={d.media.configureOverseerr} />
          ) : (
            <>
              <div className="grid gap-2 rounded-card border border-line bg-surface p-3 md:grid-cols-[minmax(14rem,1fr)_auto_auto_auto]">
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    runSearch();
                  }}
                >
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={d.media.searchPlaceholder}
                    maxLength={120}
                  />
                  <Button type="submit" variant="primary" disabled={pending}>
                    {d.common.search}
                  </Button>
                </form>
                <Input
                  value={year}
                  onChange={(event) =>
                    setYear(event.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  placeholder={d.media.year}
                  inputMode="numeric"
                  className="w-24"
                />
                <Select
                  value={rating}
                  onChange={(event) => setRating(event.target.value)}
                >
                  <option value="0">
                    {d.media.rating}: {d.media.all}
                  </option>
                  <option value="6">6+</option>
                  <option value="7">7+</option>
                  <option value="8">8+</option>
                </Select>
                <Select
                  value={sort}
                  onChange={(event) => setSort(event.target.value)}
                >
                  <option value="popularity">{d.media.popular}</option>
                  <option value="rating">{d.media.rating}</option>
                  <option value="year">{d.media.year}</option>
                  <option value="title">A–Z</option>
                </Select>
              </div>
              <div className="flex flex-wrap gap-2">
                {["all", "available", "requested", "pending", "missing"].map(
                  (value) => (
                    <button
                      key={value}
                      onClick={() => setAvailability(value)}
                      className={`rounded-full border px-3 py-1 text-xs ${availability === value ? "border-accent bg-accent/10 text-accent" : "border-line text-muted"}`}
                    >
                      {value === "all"
                        ? d.media.all
                        : value === "available"
                          ? d.media.available
                          : value === "requested"
                            ? d.media.requested
                            : value === "pending"
                              ? d.media.pending
                              : d.media.missing}
                    </button>
                  ),
                )}
              </div>
              {filtered.length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
                  {filtered.map((item) => (
                    <MediaPoster
                      key={`${item.kind}-${item.id}`}
                      item={item}
                      d={d}
                      disabled={pending || !canManage}
                      onOpen={() => openDiscoverDetails(item)}
                      onRequest={() => openDiscoverDetails(item)}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState title={d.media.noResults} />
              )}
              {result.page < result.pages && (
                <div className="text-center">
                  <Button
                    disabled={pending}
                    onClick={() => runSearch(result.page + 1, true)}
                  >
                    {d.media.loadMore}
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {tab === "library" &&
        (!library.configured ? (
          <EmptyState title={d.media.configureJellyfin} />
        ) : libraryItems.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {libraryItems.map((item) => (
              <LibraryPoster
                key={item.id}
                item={item}
                d={d}
                webLink={webLink(item.id)}
                watched={history.some((entry) => entry.jellyfinId === item.id)}
                onWatch={() => addToHistory(item)}
                onDetails={() => openLibraryDetails(item)}
                onOpenApp={() => openApp(item.id)}
                hasApp={!!jellyfin.appUrl}
              />
            ))}
          </div>
        ) : (
          <EmptyState title={d.media.noResults} />
        ))}

      {tab === "history" && (
        <WatchJournal
          d={dictionary}
          entries={history}
          onChange={setHistory}
          jellyfinConfigured={library.configured}
          jellyfinProfiles={jellyfinProfiles}
          initialJellyfinUserId={jellyfinUserId}
        />
      )}

      {tab === "requests" &&
        (requests.length || automationTasks.length ? (
          <div className="space-y-5">
            {requests.length > 0 && (
              <section className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {d.media.overseerrRequests}
                </p>
                {requests.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-card border border-line bg-surface p-3"
              >
                {item.poster ? (
                  <img
                    src={item.poster}
                    alt=""
                    className="h-16 w-11 rounded-md object-cover"
                  />
                ) : (
                  <div className="h-16 w-11 rounded-md bg-raised" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{item.title}</p>
                  <p className="text-xs text-muted">
                    {item.requestedBy} ·{" "}
                    {item.createdAt
                      ? new Date(item.createdAt).toLocaleDateString(d.lang)
                      : ""}
                  </p>
                  <RequestProgress
                    status={item.status}
                    download={matchingDownload(item.title, downloads)}
                    d={d}
                  />
                </div>
                <Badge
                  tone={
                    item.status === "approved"
                      ? "ok"
                      : item.status === "pending"
                        ? "warn"
                        : "neutral"
                  }
                >
                  {item.status}
                </Badge>
                {canManage && (
                  <Button
                    variant="quiet"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const response = await cancelMediaRequest(item.id);
                        if (response.ok)
                          setRequests((current) =>
                            current.filter((entry) => entry.id !== item.id),
                          );
                        else setMessage(response.error ?? d.common.failed);
                      })
                    }
                  >
                    {d.media.cancelRequest}
                  </Button>
                )}
              </div>
                ))}
              </section>
            )}
            {automationTasks.length > 0 && (
              <section className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {d.media.automationActivity}
                </p>
                {automationTasks.map((task) => (
                  <AutomationTaskRow key={task.id} task={task} d={d} />
                ))}
              </section>
            )}
          </div>
        ) : (
          <EmptyState
            title={
              result.configured
                ? d.media.noRequests
                : d.media.configureOverseerr
            }
          />
        ))}

      {tab === "downloads" &&
        (!initialDownloads.configured ? (
          <EmptyState title={d.media.configureQbit} />
        ) : downloads.length ? (
          <div className="space-y-2">
            {downloads.map((item) => (
              <DownloadRow
                key={item.hash}
                item={item}
                d={d}
                disabled={pending || !canManage}
                onAction={(action, deleteFiles) =>
                  startTransition(async () => {
                    const response = await manageDownload(
                      item.hash,
                      action,
                      deleteFiles,
                    );
                    if (!response.ok)
                      setMessage(response.error ?? d.common.failed);
                    if (response.ok && action === "delete")
                      setDownloads((current) =>
                        current.filter((entry) => entry.hash !== item.hash),
                      );
                  })
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState title={d.media.noDownloads} />
        ))}
      <Dialog
        open={!!selected}
        onClose={() => {
          setSelected(null);
          setSelectedDetails(null);
        }}
        title={selected?.title ?? d.media.details}
        wide
      >
        {selected &&
          (selectedDetails ? (
            <MediaDetails
              item={selectedDetails}
              profiles={selectedProfiles}
              d={d}
              disabled={pending || !canManage}
              onClose={() => setSelected(null)}
              onRequest={(options) => sendRequest(selected, options)}
            />
          ) : selectedDetailsError ? (
            <>
              <MediaDetails
                item={{ ...selected, genres: [], studios: [], seasons: [] }}
                profiles={[]}
                d={d}
                disabled={pending || !canManage}
                onClose={() => setSelected(null)}
                onRequest={(options) => sendRequest(selected, options)}
              />
              <p className="text-xs text-warn">{selectedDetailsError}</p>
            </>
          ) : (
            <div className="py-12 text-center text-sm text-muted">
              {d.media.loadingDetails}
            </div>
          ))}
      </Dialog>
      <Dialog
        open={!!librarySelected}
        onClose={() => {
          setLibrarySelected(null);
          setLibraryDetails(null);
        }}
        title={librarySelected?.title ?? d.media.details}
        wide
      >
        {librarySelected &&
          (libraryDetails ? (
            <LibraryDetails
              item={libraryDetails}
              d={d}
              webLink={webLink(libraryDetails.id)}
              onOpenApp={() => openApp(libraryDetails.id)}
              hasApp={!!jellyfin.appUrl}
            />
          ) : libraryDetailsError ? (
            <EmptyState title={libraryDetailsError} />
          ) : (
            <div className="py-12 text-center text-sm text-muted">
              {d.media.loadingDetails}
            </div>
          ))}
      </Dialog>
    </div>
  );
}

function MediaPoster({
  item,
  d,
  disabled,
  onOpen,
  onRequest,
}: {
  item: MediaCard;
  d: MediaDictionary;
  disabled: boolean;
  onOpen: () => void;
  onRequest: () => void;
}) {
  const label =
    item.status === "available"
      ? d.media.available
      : item.status === "partially-available"
        ? d.media.partlyAvailable
        : item.status === "requested"
          ? d.media.requested
          : item.status === "pending"
            ? d.media.pending
            : d.media.missing;
  return (
    <article className="group overflow-hidden rounded-card border border-line bg-surface">
      <button
        type="button"
        onClick={onOpen}
        className="relative block aspect-[2/3] w-full overflow-hidden bg-raised text-left"
      >
        {item.poster ? (
          <img
            src={item.poster}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-4xl text-faint">
            {item.kind === "tv" ? "▣" : "▶"}
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-3 pt-10 text-white">
          <p className="line-clamp-2 text-sm font-semibold">{item.title}</p>
          <p className="mt-1 text-xs text-white/70">
            {item.year ?? "—"}
            {item.rating ? ` · ★ ${item.rating.toFixed(1)}` : ""}
          </p>
        </div>
        <div className="absolute left-2 top-2">
          <Badge tone={statusTone(item.status)}>{label}</Badge>
        </div>
      </button>
      <div className="space-y-2 p-3">
        <p className="line-clamp-3 min-h-[3.75rem] text-xs leading-5 text-muted">
          {item.overview || label}
        </p>
        {item.status === "missing" ? (
          <Button
            size="sm"
            variant="primary"
            disabled={disabled}
            className="w-full"
            onClick={onRequest}
          >
            {d.media.request}
          </Button>
        ) : (
          <Button size="sm" className="w-full" onClick={onOpen}>
            {d.media.details}
          </Button>
        )}
      </div>
    </article>
  );
}

function MediaDetails({
  item,
  profiles,
  d,
  disabled,
  onClose,
  onRequest,
}: {
  item: MediaDetailsData;
  profiles: MediaQualityProfile[];
  d: MediaDictionary;
  disabled: boolean;
  onClose: () => void;
  onRequest: (options: {
    is4k: boolean;
    seasons?: number[];
    serverId?: number;
    profileId?: number;
    rootFolder?: string;
  }) => void;
}) {
  const [quality, setQuality] = useState(profiles[0]?.key ?? "standard");
  const [allSeasons, setAllSeasons] = useState(true);
  const [seasons, setSeasons] = useState<number[]>([]);
  const metadata = [
    item.kind === "movie" ? d.media.movies : d.media.series,
    item.year,
    item.runtimeMinutes ? `${item.runtimeMinutes} ${d.media.minutes}` : null,
    item.rating ? `★ ${item.rating.toFixed(1)}` : null,
    item.releaseStatus,
  ].filter(Boolean);
  const toggleSeason = (number: number) =>
    setSeasons((current) =>
      current.includes(number)
        ? current.filter((value) => value !== number)
        : [...current, number],
    );
  const selectedProfile = profiles.find((profile) => profile.key === quality);

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl bg-raised">
        {item.backdrop && (
          <img
            src={item.backdrop}
            alt=""
            className="h-52 w-full object-cover opacity-70 sm:h-72"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-5 text-white">
          <p className="text-2xl font-semibold">{item.title}</p>
          {item.originalTitle && item.originalTitle !== item.title && (
            <p className="text-sm text-white/60">{item.originalTitle}</p>
          )}
          <p className="mt-2 text-sm text-white/75">{metadata.join(" · ")}</p>
        </div>
      </div>
      {item.tagline && (
        <p className="text-lg italic text-muted">“{item.tagline}”</p>
      )}
      {item.genres.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {item.genres.map((genre) => (
            <Badge key={genre}>{genre}</Badge>
          ))}
        </div>
      )}
      <p className="whitespace-pre-line text-sm leading-6 text-muted">
        {item.overview || d.media.noResults}
      </p>
      {item.studios.length > 0 && (
        <p className="text-xs text-faint">{item.studios.join(" · ")}</p>
      )}
      {item.status === "missing" && (
        <section className="rounded-2xl border border-accent/30 bg-accent/5 p-4">
          <div className="mb-3">
            <p className="font-semibold">{d.media.downloadSetup}</p>
            <p className="text-xs text-muted">{d.media.downloadSetupHint}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldLabel label={d.media.quality}>
              <Select
                value={quality}
                onChange={(event) => setQuality(event.target.value)}
              >
                {profiles.length ? (
                  profiles.map((profile) => (
                    <option key={profile.key} value={profile.key}>
                      {profile.label}
                    </option>
                  ))
                ) : (
                  <>
                    <option value="standard">{d.media.standardQuality}</option>
                    <option value="4k">4K / UHD</option>
                  </>
                )}
              </Select>
            </FieldLabel>
            {item.kind === "tv" && item.seasons.length > 0 && (
              <FieldLabel label={d.media.seasons}>
                <label className="mb-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={allSeasons}
                    onChange={(event) => setAllSeasons(event.target.checked)}
                  />
                  {d.media.allSeasons}
                </label>
                {!allSeasons && (
                  <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                    {item.seasons.map((season) => (
                      <button
                        key={season.number}
                        type="button"
                        onClick={() => toggleSeason(season.number)}
                        className={`rounded-full border px-2.5 py-1 text-xs ${seasons.includes(season.number) ? "border-accent bg-accent/10 text-accent" : "border-line text-muted"}`}
                      >
                        {season.name || `${d.media.seasons} ${season.number}`} ·{" "}
                        {season.episodeCount}
                      </button>
                    ))}
                  </div>
                )}
              </FieldLabel>
            )}
          </div>
          <Button
            className="mt-4 w-full"
            variant="primary"
            disabled={
              disabled ||
              (item.kind === "tv" && !allSeasons && seasons.length === 0)
            }
            onClick={() =>
              onRequest({
                is4k: selectedProfile?.is4k ?? quality === "4k",
                serverId: selectedProfile?.serverId,
                profileId: selectedProfile?.profileId,
                rootFolder: selectedProfile?.rootFolder,
                seasons:
                  item.kind === "tv" && !allSeasons ? seasons : undefined,
              })
            }
          >
            {d.media.confirmRequest}
          </Button>
        </section>
      )}
      {item.status !== "missing" && (
        <div className="rounded-control border border-line bg-raised p-3 text-sm">
          <Badge tone={statusTone(item.status)}>
            {item.status === "available"
              ? d.media.available
              : item.status === "pending"
                ? d.media.pending
                : d.media.requested}
          </Badge>
          <span className="ml-2 text-muted">{d.media.alreadyTracked}</span>
        </div>
      )}
      <div className="flex justify-end">
        <Button onClick={onClose}>{d.common.close}</Button>
      </div>
    </div>
  );
}

function FieldLabel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

function LibraryPoster({
  item,
  d,
  webLink,
  watched,
  onWatch,
  onDetails,
  onOpenApp,
  hasApp,
}: {
  item: JellyfinLibraryItem;
  d: MediaDictionary;
  webLink: string;
  watched: boolean;
  onWatch: () => void;
  onDetails: () => void;
  onOpenApp: () => void;
  hasApp: boolean;
}) {
  return (
    <article className="group overflow-hidden rounded-card border border-line bg-surface">
      <button
        type="button"
        onClick={onDetails}
        className="relative block aspect-[2/3] w-full bg-raised text-left"
      >
        {item.poster ? (
          <img
            src={item.poster}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
          />
        ) : null}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-3 pt-12 text-white">
          <p className="line-clamp-2 text-sm font-semibold">{item.title}</p>
          <p className="text-xs text-white/70">
            {item.year ?? ""}
            {item.played ? ` · ${d.media.markPlayed}` : ""}
          </p>
        </div>
        {item.progress > 0 && (
          <div className="absolute inset-x-2 bottom-1">
            <Meter value={item.progress} tone="ok" />
          </div>
        )}
      </button>
      <div className="flex flex-col gap-2 p-3">
        <Button size="sm" onClick={onDetails}>
          {d.media.details}
        </Button>
        <Button size="sm" disabled={watched} onClick={onWatch}>
          {watched ? d.media.inWatched : d.media.addWatched}
        </Button>
        {hasApp && (
          <Button size="sm" variant="primary" onClick={onOpenApp}>
            {d.media.openApp}
          </Button>
        )}
        <a
          href={webLink}
          target="_blank"
          rel="noreferrer"
          className="rounded-control border border-line px-2.5 py-1 text-center text-xs font-medium hover:bg-raised"
        >
          {d.media.openWeb}
        </a>
      </div>
    </article>
  );
}

function LibraryDetails({
  item,
  d,
  webLink,
  onOpenApp,
  hasApp,
}: {
  item: JellyfinDetails;
  d: MediaDictionary;
  webLink: string;
  onOpenApp: () => void;
  hasApp: boolean;
}) {
  const [seasonId, setSeasonId] = useState(item.seasons[0]?.id ?? "");
  const episodes = item.episodes.filter(
    (episode) => episode.seasonId === seasonId,
  );
  const metadata = [
    item.kind === "movie" ? d.media.movies : d.media.series,
    item.year ? String(item.year) : "",
    item.runtimeMinutes ? `${item.runtimeMinutes} ${d.media.minutes}` : "",
    item.rating ? `★ ${item.rating.toFixed(1)}` : "",
    item.officialRating ?? "",
  ].filter(Boolean);

  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-[10rem_1fr]">
        <div className="overflow-hidden rounded-xl bg-raised">
          {item.poster && (
            <img
              src={item.poster}
              alt=""
              className="aspect-[2/3] h-full w-full object-cover"
            />
          )}
        </div>
        <div className="space-y-3">
          <div>
            <p className="text-xl font-semibold">{item.title}</p>
            <p className="mt-1 text-sm text-muted">{metadata.join(" · ")}</p>
          </div>
          {item.genres.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {item.genres.map((genre) => (
                <Badge key={genre}>{genre}</Badge>
              ))}
            </div>
          )}
          <p className="whitespace-pre-line text-sm leading-6 text-muted">
            {item.overview || d.media.noOverview}
          </p>
          {item.studios.length > 0 && (
            <p className="text-xs text-faint">{item.studios.join(" · ")}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {hasApp && (
              <Button variant="primary" onClick={onOpenApp}>
                {d.media.openApp}
              </Button>
            )}
            <a
              href={webLink}
              target="_blank"
              rel="noreferrer"
              className="rounded-control border border-line px-3 py-2 text-sm font-medium hover:bg-raised"
            >
              {d.media.openWeb}
            </a>
          </div>
        </div>
      </div>
      {item.progress > 0 && (
        <div>
          <div className="mb-1 flex justify-between text-xs text-muted">
            <span>{d.media.watchProgress}</span>
            <span>{Math.round(item.progress)}%</span>
          </div>
          <Meter value={item.progress} tone="ok" />
        </div>
      )}
      {item.people.length > 0 && (
        <section>
          <p className="mb-2 text-sm font-semibold">{d.media.cast}</p>
          <div className="flex flex-wrap gap-2">
            {item.people.map((person) => (
              <span
                key={`${person.name}-${person.role}`}
                className="rounded-full border border-line bg-raised px-2.5 py-1 text-xs"
              >
                <span className="font-medium">{person.name}</span>
                {person.role && (
                  <span className="text-muted"> · {person.role}</span>
                )}
              </span>
            ))}
          </div>
        </section>
      )}
      {item.seasons.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">{d.media.seasons}</p>
            <Select
              value={seasonId}
              onChange={(event) => setSeasonId(event.target.value)}
            >
              {item.seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.title} · {season.episodeCount} {d.media.episodes}
                </option>
              ))}
            </Select>
          </div>
          <div className="max-h-[24rem] space-y-2 overflow-y-auto pr-1">
            {episodes.length ? (
              episodes.map((episode) => (
                <article
                  key={episode.id}
                  className="rounded-xl border border-line bg-surface p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {episode.number ? `${episode.number}. ` : ""}
                        {episode.title}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        {episode.runtimeMinutes
                          ? `${episode.runtimeMinutes} ${d.media.minutes}`
                          : ""}
                        {episode.played ? ` · ${d.media.markPlayed}` : ""}
                      </p>
                    </div>
                    {episode.progress > 0 && (
                      <Badge tone="accent">
                        {Math.round(episode.progress)}%
                      </Badge>
                    )}
                  </div>
                  {episode.overview && (
                    <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted">
                      {episode.overview}
                    </p>
                  )}
                  {episode.progress > 0 && (
                    <div className="mt-2">
                      <Meter value={episode.progress} tone="ok" />
                    </div>
                  )}
                </article>
              ))
            ) : (
              <EmptyState title={d.media.noEpisodes} />
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function RequestProgress({
  status,
  download,
  d,
}: {
  status: string;
  download?: DownloadItem | null;
  d: MediaDictionary;
}) {
  const percent = download
    ? Math.max(0, Math.min(100, download.progress * 100))
    : 0;
  const complete = !!download && percent >= 99.95;
  const current = complete ? 3 : download ? 2 : status === "approved" ? 1 : 0;
  const steps = [d.media.requested, d.media.approved, d.media.downloading];
  return (
    <div className="mt-2 max-w-xl">
      <div className="flex items-center">
        {steps.map((step, index) => (
          <div
            key={step}
            className="flex min-w-0 flex-1 items-center last:flex-none"
          >
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${index <= current ? "bg-accent text-white" : "bg-raised text-faint"}`}
            >
              {index < current ? "✓" : index + 1}
            </span>
            <span
              className={`ml-1 truncate text-[10px] ${index <= current ? "text-text" : "text-faint"}`}
            >
              {step}
            </span>
            {index < steps.length - 1 && (
              <span
                className={`mx-2 h-px min-w-3 flex-1 ${index < current ? "bg-accent" : "bg-line"}`}
              />
            )}
          </div>
        ))}
      </div>
      {download && (
        <div className="mt-2 rounded-control border border-line bg-raised/60 px-2.5 py-2">
          <div className="mb-1.5 flex items-center justify-between gap-3 text-[11px] text-muted">
            <span className="truncate">{download.name}</span>
            <span className="shrink-0 font-mono tabular-nums text-text">
              {percent.toFixed(percent >= 10 ? 0 : 1)}%
            </span>
          </div>
          <Meter value={percent} tone="ok" />
          <p className="mt-1.5 text-[11px] text-faint">
            ↓ {speed(download.downloadSpeed)} · {eta(download.eta)} ·{" "}
            {size(download.size)}
          </p>
        </div>
      )}
    </div>
  );
}

function AutomationTaskRow({
  task,
  d,
}: {
  task: MediaAutomationTask;
  d: MediaDictionary;
}) {
  const stateLabels: Record<MediaAutomationTask["state"], string> = {
    tracked: d.media.activityTracked,
    searching: d.media.activitySearching,
    queued: d.media.activityQueued,
    downloading: d.media.downloading,
    importing: d.media.activityImporting,
    failed: d.media.activityFailed,
    completed: d.media.activityCompleted,
  };
  const tone =
    task.state === "failed"
      ? "danger"
      : task.state === "completed" || task.state === "tracked"
        ? "ok"
        : task.state === "searching" || task.state === "queued"
          ? "warn"
          : "accent";
  return (
    <article className="rounded-card border border-line bg-surface p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <img
              src={serviceLogo(task.service)}
              alt=""
              className="h-6 w-6 shrink-0 rounded-md object-contain"
            />
            <p className="truncate font-medium">{task.title}</p>
          </div>
          <p className="mt-1 text-xs text-muted">
            {task.server}
            {task.createdAt
              ? ` · ${new Date(task.createdAt).toLocaleString(d.lang)}`
              : ""}
          </p>
          {task.detail && (
            <p className="mt-1 line-clamp-2 text-xs text-faint">
              {task.detail}
            </p>
          )}
        </div>
        <Badge tone={tone}>{stateLabels[task.state]}</Badge>
      </div>
      {task.progress !== undefined && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-[11px] text-muted">
            <span>{d.media.downloadProgress}</span>
            <span className="font-mono text-text">{task.progress.toFixed(0)}%</span>
          </div>
          <Meter value={task.progress} tone="ok" />
        </div>
      )}
    </article>
  );
}

function ServiceIssuesPanel({
  d,
  issues,
  expanded,
  refreshing,
  onRefresh,
  onToggle,
}: {
  d: MediaDictionary;
  issues: MediaServiceIssue[];
  expanded: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onToggle: () => void;
}) {
  if (issues.length === 0)
    return (
      <EmptyState
        title={d.media.servicesHealthy}
        hint={d.media.servicesHealthyHint}
        action={
          <Button size="sm" onClick={onRefresh} disabled={refreshing}>
            {d.media.refreshIssues}
          </Button>
        }
      />
    );

  return (
    <section className="overflow-hidden rounded-card border border-warn/35 bg-warn/5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-warn/20 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-warn" aria-hidden />
            <h2 className="font-semibold">{d.media.serviceIssues}</h2>
            <Badge tone="warn">{issues.length}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted">{d.media.serviceIssuesHint}</p>
        </div>
        <Button
          size="sm"
          variant="quiet"
          disabled={refreshing}
          onClick={onRefresh}
        >
          {d.media.refreshIssues}
        </Button>
      </div>
      <div className="divide-y divide-line/70">
        {(expanded ? issues : issues.slice(0, 5)).map((issue) => (
          <div
            key={issue.key}
            className="flex items-start gap-3 px-4 py-3 text-sm"
          >
            <span
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${issue.severity === "error" ? "bg-danger" : "bg-warn"}`}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{issue.server}</span>
                <Badge tone={issue.severity === "error" ? "danger" : "warn"}>
                  {issue.service === "sonarr" ? "Sonarr" : "Radarr"}
                </Badge>
                <span className="text-xs text-faint">{issue.source}</span>
              </div>
              <p className="mt-1 leading-5 text-muted">{issue.message}</p>
            </div>
          </div>
        ))}
      </div>
      {issues.length > 5 && (
        <button
          type="button"
          className="w-full border-t border-warn/20 px-4 py-2.5 text-left text-xs font-medium text-muted transition-colors hover:bg-warn/10 hover:text-text"
          onClick={onToggle}
        >
          {expanded
            ? d.media.hideIssues
            : d.media.showAllIssues.replace("{count}", String(issues.length))}
        </button>
      )}
    </section>
  );
}

function DownloadRow({
  item,
  d,
  disabled,
  onAction,
}: {
  item: DownloadItem;
  d: MediaDictionary;
  disabled: boolean;
  onAction: (
    action: "pause" | "resume" | "recheck" | "delete",
    deleteFiles?: boolean,
  ) => void;
}) {
  const active = /downloading|uploading|forced|stalled/i.test(item.state);
  return (
    <article className="rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium">{item.name}</p>
            <Badge
              tone={
                /error|missing/i.test(item.state)
                  ? "danger"
                  : active
                    ? "accent"
                    : "neutral"
              }
            >
              {item.state}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted">
            {size(item.size)} · ↓ {speed(item.downloadSpeed)} · ↑{" "}
            {speed(item.uploadSpeed)} · {eta(item.eta)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            disabled={disabled}
            onClick={() => onAction(active ? "pause" : "resume")}
          >
            {active ? d.media.pause : d.media.resume}
          </Button>
          <Button
            size="sm"
            disabled={disabled}
            onClick={() => onAction("recheck")}
          >
            {d.media.recheck}
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={disabled}
            onClick={() => onAction("delete", false)}
          >
            {d.media.remove}
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={disabled}
            onClick={() => {
              if (confirm(d.media.destructiveConfirm)) onAction("delete", true);
            }}
          >
            {d.media.removeFiles}
          </Button>
        </div>
      </div>
      <div className="mt-3">
        <Meter
          value={item.progress}
          tone={item.progress >= 100 ? "ok" : undefined}
        />
        <p className="mt-1 text-right font-mono text-[11px] text-muted">
          {item.progress.toFixed(1)}%
        </p>
      </div>
    </article>
  );
}
