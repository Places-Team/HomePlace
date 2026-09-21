"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { cancelMediaRequest, manageDownload, requestMedia, searchMedia } from "@/actions/media";
import type { Dictionary } from "@/i18n";
import type { DownloadItem, JellyfinLibraryItem, MediaCard, MediaRequest } from "@/lib/media";
import { Badge, EmptyState, Meter } from "@/components/ui";
import { Button, Input, Select } from "@/components/form";
import { Dialog } from "@/components/Dialog";
import { serviceLogo } from "@/lib/icons";
import { isHomeNetworkHost, jellyfinNativeLink, jellyfinWebLink } from "@/lib/jellyfinLinks";

type Tab = "discover" | "library" | "requests" | "downloads";
type DiscoverResult = { configured: boolean; page: number; pages: number; items: MediaCard[] };
type MediaDictionary = Dictionary & { media: Dictionary["mediaCenter"] & Dictionary["media"] };

const statusTone = (status: MediaCard["status"]) =>
  status === "available" ? "ok" : status === "pending" ? "warn" : status === "requested" || status === "partially-available" ? "accent" : "neutral";

const speed = (bytes: number) => bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MiB/s` : `${Math.round(bytes / 1024)} KiB/s`;
const size = (bytes: number) => bytes > 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GiB` : `${(bytes / 1024 ** 2).toFixed(0)} MiB`;
const eta = (seconds: number) => !Number.isFinite(seconds) || seconds > 8640000 ? "—" : seconds > 3600 ? `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m` : `${Math.ceil(seconds / 60)}m`;

export function MediaLibrary({
  d: dictionary,
  initialDiscover,
  library,
  requests: initialRequests,
  downloads: initialDownloads,
  jellyfin,
  canManage,
}: {
  d: Dictionary;
  initialDiscover: DiscoverResult;
  library: { configured: boolean; items: JellyfinLibraryItem[] };
  requests: MediaRequest[];
  downloads: { configured: boolean; items: DownloadItem[] };
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
  const [requests, setRequests] = useState(initialRequests);
  const [downloads, setDownloads] = useState(initialDownloads.items);
  const [preferLocal, setPreferLocal] = useState(false);
  const [lanDetected, setLanDetected] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const detected = isHomeNetworkHost(window.location.hostname);
    setLanDetected(detected);
    const saved = window.localStorage.getItem("homeplace:jellyfin-local");
    setPreferLocal(saved === null ? detected : saved === "1");
  }, []);

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

  function runSearch(nextPage = 1, append = false) {
    setMessage("");
    startTransition(async () => {
      const next = await searchMedia({ query, kind, page: nextPage });
      setResult(append ? { ...next, items: [...result.items, ...next.items] } : next);
    });
  }

  function sendRequest(item: MediaCard) {
    startTransition(async () => {
      const response = await requestMedia({ kind: item.kind, mediaId: item.id });
      setMessage(response.ok ? d.media.requestSent : response.error ?? d.common.failed);
      if (response.ok) {
        setResult((current) => ({ ...current, items: current.items.map((entry) => entry.id === item.id ? { ...entry, status: "requested" } : entry) }));
      }
    });
  }

  const webBase = preferLocal && jellyfin.localUrl ? jellyfin.localUrl : jellyfin.url;
  const webLink = (id: string) => jellyfinWebLink(webBase, id);

  function openApp(id: string) {
    const native = jellyfinNativeLink(jellyfin.appUrl, id);
    if (!native) return void window.open(webLink(id), "_blank", "noopener,noreferrer");
    let hidden = false;
    const visibility = () => { hidden ||= document.hidden; };
    document.addEventListener("visibilitychange", visibility, { once: true });
    const launcher = document.createElement("a");
    launcher.href = native;
    launcher.click();
    window.setTimeout(() => {
      document.removeEventListener("visibilitychange", visibility);
      if (!hidden && document.visibilityState === "visible") window.open(webLink(id), "_blank", "noopener,noreferrer");
    }, 1300);
  }

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "discover", label: d.media.discover },
    { key: "library", label: d.media.library, count: library.items.length },
    { key: "requests", label: d.media.requests, count: requests.length },
    { key: "downloads", label: d.media.downloads, count: downloads.length },
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={serviceLogo("jellyfin")} alt="" className="h-11 w-11 rounded-xl object-contain" />
          <div><h1 className="text-2xl font-semibold tracking-tight">{d.media.title}</h1><p className="text-sm text-muted">{d.media.subtitle}</p></div>
        </div>
        {jellyfin.localUrl && (
          <label className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-2 text-xs text-muted">
            <input type="checkbox" checked={preferLocal} onChange={(event) => { setPreferLocal(event.target.checked); localStorage.setItem("homeplace:jellyfin-local", event.target.checked ? "1" : "0"); }} />
            {d.media.preferLocal}
            {(preferLocal || lanDetected) && <span className="h-1.5 w-1.5 rounded-full bg-ok" title={d.media.localActive} />}
          </label>
        )}
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label={d.media.title}>
        {tabs.map((item) => <button key={item.key} onClick={() => setTab(item.key)} className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${tab === item.key ? "border-accent text-text" : "border-transparent text-muted hover:text-text"}`}>{item.label}{item.count !== undefined && <span className="ml-2 rounded-full bg-raised px-1.5 py-0.5 text-[10px]">{item.count}</span>}</button>)}
      </nav>

      {message && <div role="status" className="rounded-control border border-line bg-raised px-3 py-2 text-sm">{message}</div>}

      {tab === "discover" && (
        <section className="space-y-4">
          {!result.configured ? <EmptyState title={d.media.configureOverseerr} /> : <>
            <div className="grid gap-2 rounded-card border border-line bg-surface p-3 md:grid-cols-[minmax(14rem,1fr)_auto_auto_auto_auto]">
              <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); runSearch(); }}><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={d.media.searchPlaceholder} maxLength={120} /><Button type="submit" variant="primary" disabled={pending}>{d.common.search}</Button></form>
              <Select value={kind} onChange={(event) => { const value = event.target.value as typeof kind; setKind(value); startTransition(async () => setResult(await searchMedia({ query, kind: value }))); }}><option value="all">{d.media.all}</option><option value="movie">{d.media.movies}</option><option value="tv">{d.media.series}</option></Select>
              <Input value={year} onChange={(event) => setYear(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder={d.media.year} inputMode="numeric" className="w-24" />
              <Select value={rating} onChange={(event) => setRating(event.target.value)}><option value="0">{d.media.rating}: {d.media.all}</option><option value="6">6+</option><option value="7">7+</option><option value="8">8+</option></Select>
              <Select value={sort} onChange={(event) => setSort(event.target.value)}><option value="popularity">{d.media.popular}</option><option value="rating">{d.media.rating}</option><option value="year">{d.media.year}</option><option value="title">A–Z</option></Select>
            </div>
            <div className="flex flex-wrap gap-2">{["all", "available", "requested", "pending", "missing"].map((value) => <button key={value} onClick={() => setAvailability(value)} className={`rounded-full border px-3 py-1 text-xs ${availability === value ? "border-accent bg-accent/10 text-accent" : "border-line text-muted"}`}>{value === "all" ? d.media.all : value === "available" ? d.media.available : value === "requested" ? d.media.requested : value === "pending" ? d.media.pending : d.media.missing}</button>)}</div>
            {filtered.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">{filtered.map((item) => <MediaPoster key={`${item.kind}-${item.id}`} item={item} d={d} disabled={pending || !canManage} onOpen={() => setSelected(item)} onRequest={() => sendRequest(item)} />)}</div> : <EmptyState title={d.media.noResults} />}
            {result.page < result.pages && <div className="text-center"><Button disabled={pending} onClick={() => runSearch(result.page + 1, true)}>{d.media.loadMore}</Button></div>}
          </>}
        </section>
      )}

      {tab === "library" && (!library.configured ? <EmptyState title={d.media.configureJellyfin} /> : library.items.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">{library.items.map((item) => <LibraryPoster key={item.id} item={item} d={d} webLink={webLink(item.id)} onOpenApp={() => openApp(item.id)} hasApp={!!jellyfin.appUrl} />)}</div> : <EmptyState title={d.media.noResults} />)}

      {tab === "requests" && (requests.length ? <div className="space-y-2">{requests.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-card border border-line bg-surface p-3">{item.poster ? <img src={item.poster} alt="" className="h-16 w-11 rounded-md object-cover" /> : <div className="h-16 w-11 rounded-md bg-raised" />}<div className="min-w-0 flex-1"><p className="truncate font-medium">{item.title}</p><p className="text-xs text-muted">{item.requestedBy} · {item.createdAt ? new Date(item.createdAt).toLocaleDateString(d.lang) : ""}</p></div><Badge tone={item.status === "approved" ? "ok" : item.status === "pending" ? "warn" : "neutral"}>{item.status}</Badge>{canManage && <Button variant="quiet" disabled={pending} onClick={() => startTransition(async () => { const response = await cancelMediaRequest(item.id); if (response.ok) setRequests((current) => current.filter((entry) => entry.id !== item.id)); else setMessage(response.error ?? d.common.failed); })}>{d.media.cancelRequest}</Button>}</div>)}</div> : <EmptyState title={result.configured ? d.media.noRequests : d.media.configureOverseerr} />)}

      {tab === "downloads" && (!initialDownloads.configured ? <EmptyState title={d.media.configureQbit} /> : downloads.length ? <div className="space-y-2">{downloads.map((item) => <DownloadRow key={item.hash} item={item} d={d} disabled={pending || !canManage} onAction={(action, deleteFiles) => startTransition(async () => { const response = await manageDownload(item.hash, action, deleteFiles); if (!response.ok) setMessage(response.error ?? d.common.failed); if (response.ok && action === "delete") setDownloads((current) => current.filter((entry) => entry.hash !== item.hash)); })} />)}</div> : <EmptyState title={d.media.noDownloads} />)}
      <Dialog open={!!selected} onClose={() => setSelected(null)} title={selected?.title ?? d.media.details} wide>
        {selected && <MediaDetails item={selected} d={d} disabled={pending || !canManage} onClose={() => setSelected(null)} onRequest={() => sendRequest(selected)} />}
      </Dialog>
    </div>
  );
}

function MediaPoster({ item, d, disabled, onOpen, onRequest }: { item: MediaCard; d: MediaDictionary; disabled: boolean; onOpen: () => void; onRequest: () => void }) {
  const label = item.status === "available" ? d.media.available : item.status === "partially-available" ? d.media.partlyAvailable : item.status === "requested" ? d.media.requested : item.status === "pending" ? d.media.pending : d.media.missing;
  return <article className="group overflow-hidden rounded-card border border-line bg-surface"><button type="button" onClick={onOpen} className="relative block aspect-[2/3] w-full overflow-hidden bg-raised text-left">{item.poster ? <img src={item.poster} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" /> : <div className="flex h-full items-center justify-center text-4xl text-faint">{item.kind === "tv" ? "▣" : "▶"}</div>}<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-3 pt-10 text-white"><p className="line-clamp-2 text-sm font-semibold">{item.title}</p><p className="mt-1 text-xs text-white/70">{item.year ?? "—"}{item.rating ? ` · ★ ${item.rating.toFixed(1)}` : ""}</p></div><div className="absolute left-2 top-2"><Badge tone={statusTone(item.status)}>{label}</Badge></div></button><div className="space-y-2 p-3"><p className="line-clamp-3 min-h-[3.75rem] text-xs leading-5 text-muted">{item.overview || label}</p>{item.status === "missing" ? <Button size="sm" variant="primary" disabled={disabled} className="w-full" onClick={onRequest}>{d.media.request}</Button> : <Button size="sm" className="w-full" onClick={onOpen}>{d.media.details}</Button>}</div></article>;
}

function MediaDetails({ item, d, disabled, onClose, onRequest }: { item: MediaCard; d: MediaDictionary; disabled: boolean; onClose: () => void; onRequest: () => void }) {
  return <div className="space-y-4"><div className="relative overflow-hidden rounded-card bg-raised">{item.backdrop && <img src={item.backdrop} alt="" className="h-48 w-full object-cover opacity-70 sm:h-64" />}<div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" /><div className="absolute inset-x-0 bottom-0 p-5 text-white"><p className="text-2xl font-semibold">{item.title}</p><p className="mt-1 text-sm text-white/75">{item.kind === "movie" ? d.media.movies : d.media.series}{item.year ? ` · ${item.year}` : ""}{item.rating ? ` · ★ ${item.rating.toFixed(1)}` : ""}</p></div></div><p className="whitespace-pre-line text-sm leading-6 text-muted">{item.overview || d.media.noResults}</p><div className="flex justify-end gap-2">{item.status === "missing" && <Button variant="primary" disabled={disabled} onClick={onRequest}>{d.media.request}</Button>}<Button onClick={onClose}>{d.common.close}</Button></div></div>;
}

function LibraryPoster({ item, d, webLink, onOpenApp, hasApp }: { item: JellyfinLibraryItem; d: MediaDictionary; webLink: string; onOpenApp: () => void; hasApp: boolean }) {
  return <article className="group overflow-hidden rounded-card border border-line bg-surface"><div className="relative aspect-[2/3] bg-raised">{item.poster ? <img src={item.poster} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-3 pt-12 text-white"><p className="line-clamp-2 text-sm font-semibold">{item.title}</p><p className="text-xs text-white/70">{item.year ?? ""}</p></div>{item.progress > 0 && <div className="absolute inset-x-2 bottom-1"><Meter value={item.progress} tone="ok" /></div>}</div><div className="flex flex-col gap-2 p-3">{hasApp && <Button size="sm" variant="primary" onClick={onOpenApp}>{d.media.openApp}</Button>}<a href={webLink} target="_blank" rel="noreferrer" className="rounded-control border border-line px-2.5 py-1 text-center text-xs font-medium hover:bg-raised">{d.media.openWeb}</a></div></article>;
}

function DownloadRow({ item, d, disabled, onAction }: { item: DownloadItem; d: MediaDictionary; disabled: boolean; onAction: (action: "pause" | "resume" | "recheck" | "delete", deleteFiles?: boolean) => void }) {
  const active = /downloading|uploading|forced|stalled/i.test(item.state);
  return <article className="rounded-card border border-line bg-surface p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate font-medium">{item.name}</p><Badge tone={/error|missing/i.test(item.state) ? "danger" : active ? "accent" : "neutral"}>{item.state}</Badge></div><p className="mt-1 text-xs text-muted">{size(item.size)} · ↓ {speed(item.downloadSpeed)} · ↑ {speed(item.uploadSpeed)} · {eta(item.eta)}</p></div><div className="flex flex-wrap gap-1"><Button size="sm" disabled={disabled} onClick={() => onAction(active ? "pause" : "resume")}>{active ? d.media.pause : d.media.resume}</Button><Button size="sm" disabled={disabled} onClick={() => onAction("recheck")}>{d.media.recheck}</Button><Button size="sm" variant="danger" disabled={disabled} onClick={() => onAction("delete", false)}>{d.media.remove}</Button><Button size="sm" variant="danger" disabled={disabled} onClick={() => { if (confirm(d.media.destructiveConfirm)) onAction("delete", true); }}>{d.media.removeFiles}</Button></div></div><div className="mt-3"><Meter value={item.progress} tone={item.progress >= 100 ? "ok" : undefined} /><p className="mt-1 text-right font-mono text-[11px] text-muted">{item.progress.toFixed(1)}%</p></div></article>;
}
