"use client";

import {
  useMemo,
  useRef,
  useState,
  useTransition,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  addWatchEntry,
  deleteWatchEntry,
  editWatchEntry,
  importWatchHistory,
  selectJellyfinProfile,
  syncJellyfinWatchHistory,
} from "@/actions/media";
import type { Dictionary } from "@/i18n";
import type { JellyfinProfile } from "@/lib/media";
import type { WatchEntryView } from "@/lib/watchHistory";
import { Badge, EmptyState } from "@/components/ui";
import { Button, Input, Select } from "@/components/form";

const dateValue = (value: string) => new Date(value).toISOString().slice(0, 10);

export function WatchJournal({
  d: dictionary,
  entries,
  onChange,
  jellyfinConfigured,
  jellyfinProfiles,
  initialJellyfinUserId,
}: {
  d: Dictionary;
  entries: WatchEntryView[];
  onChange: Dispatch<SetStateAction<WatchEntryView[]>>;
  jellyfinConfigured: boolean;
  jellyfinProfiles: JellyfinProfile[];
  initialJellyfinUserId: string;
}) {
  const d = { ...dictionary, media: dictionary.mediaCenter } as Dictionary & {
    media: Dictionary["mediaCenter"] & Dictionary["media"];
  };
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "rating" | "title" | "year">(
    "recent",
  );
  const [kind, setKind] = useState<"all" | "movie" | "tv">("all");
  const [editing, setEditing] = useState<WatchEntryView | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [message, setMessage] = useState("");
  const [jellyfinUserId, setJellyfinUserId] = useState(initialJellyfinUserId);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [manual, setManual] = useState({
    title: "",
    kind: "movie",
    year: "",
    watchedAt: dateValue(new Date().toISOString()),
    rating: "",
  });

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return entries
      .filter((entry) => kind === "all" || entry.kind === kind)
      .filter(
        (entry) =>
          !needle ||
          entry.title.toLocaleLowerCase().includes(needle) ||
          entry.notes.toLocaleLowerCase().includes(needle),
      )
      .sort((a, b) => {
        if (sort === "rating") return (b.rating ?? 0) - (a.rating ?? 0);
        if (sort === "title") return a.title.localeCompare(b.title);
        if (sort === "year") return (b.year ?? 0) - (a.year ?? 0);
        return (
          new Date(b.watchedAt).getTime() - new Date(a.watchedAt).getTime()
        );
      });
  }, [entries, kind, query, sort]);

  const rated = entries.filter((entry) => entry.rating);
  const average = rated.length
    ? rated.reduce((sum, entry) => sum + (entry.rating ?? 0), 0) / rated.length
    : 0;
  const watches = entries.reduce((sum, entry) => sum + entry.rewatchCount, 0);

  function merge(next: WatchEntryView[]) {
    onChange((current) => {
      const map = new Map(current.map((entry) => [entry.id, entry]));
      for (const entry of next) map.set(entry.id, entry);
      return [...map.values()].sort(
        (a, b) =>
          new Date(b.watchedAt).getTime() - new Date(a.watchedAt).getTime(),
      );
    });
  }

  function addManual() {
    startTransition(async () => {
      const response = await addWatchEntry({
        title: manual.title,
        kind: manual.kind,
        year: Number(manual.year) || undefined,
        watchedAt: new Date(`${manual.watchedAt}T12:00:00`).toISOString(),
        rating: Number(manual.rating) || undefined,
      });
      if (response.ok && response.entry) {
        merge([response.entry]);
        setManual({
          title: "",
          kind: "movie",
          year: "",
          watchedAt: dateValue(new Date().toISOString()),
          rating: "",
        });
        setShowAdd(false);
        setMessage(d.media.entryAdded);
      } else setMessage(response.error ?? d.common.failed);
    });
  }

  function saveEdit() {
    if (!editing) return;
    startTransition(async () => {
      const response = await editWatchEntry(editing.id, {
        watchedAt: editing.watchedAt,
        rating: editing.rating,
        notes: editing.notes,
        rewatchCount: editing.rewatchCount,
      });
      if (response.ok && response.entry) {
        merge([response.entry]);
        setEditing(null);
        setMessage(d.media.saved);
      } else setMessage(response.error ?? d.common.failed);
    });
  }

  function syncJellyfin() {
    startTransition(async () => {
      const response = await syncJellyfinWatchHistory();
      if (response.ok && response.entries) {
        merge(response.entries);
        setMessage(
          `${d.media.synced}: ${response.imported ?? response.entries.length}`,
        );
      } else setMessage(response.error ?? d.common.failed);
    });
  }

  function chooseJellyfinProfile(profileId: string) {
    startTransition(async () => {
      const response = await selectJellyfinProfile(profileId);
      if (response.ok) setJellyfinUserId(profileId);
      setMessage(
        response.ok
          ? d.media.jellyfinProfileSaved
          : (response.error ?? d.common.failed),
      );
    });
  }

  async function importFile(file?: File) {
    if (!file) return;
    if (file.size > 2_000_000) return void setMessage(d.media.fileTooLarge);
    const text = await file.text();
    startTransition(async () => {
      const response = await importWatchHistory(text);
      if (response.ok && response.entries) {
        merge(response.entries);
        setMessage(
          `${d.media.imported}: ${response.imported ?? response.entries.length}`,
        );
      } else setMessage(response.error ?? d.common.failed);
    });
  }

  if (jellyfinConfigured && jellyfinProfiles.length > 0 && !jellyfinUserId) {
    return (
      <section className="space-y-4">
        <div className="rounded-card border border-line bg-surface p-5">
          <p className="font-semibold">{d.media.jellyfinProfile}</p>
          <p className="mt-1 text-sm text-muted">
            {d.media.jellyfinProfileHint}
          </p>
          <Select
            className="mt-4 max-w-sm"
            value=""
            onChange={(event) => chooseJellyfinProfile(event.target.value)}
            disabled={pending}
          >
            <option value="">{d.media.chooseJellyfinProfile}</option>
            {jellyfinProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </Select>
          {message && (
            <div
              role="status"
              className="mt-3 rounded-control border border-line bg-raised px-3 py-2 text-sm"
            >
              {message}
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="grid overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-accent/15 via-surface to-surface sm:grid-cols-3 sm:divide-x sm:divide-line">
        <div className="p-5">
          <p className="text-2xl font-semibold">{entries.length}</p>
          <p className="text-xs text-muted">{d.media.uniqueTitles}</p>
        </div>
        <div className="border-t border-line p-5 sm:border-t-0">
          <p className="text-2xl font-semibold">{watches}</p>
          <p className="text-xs text-muted">{d.media.totalWatches}</p>
        </div>
        <div className="border-t border-line p-5 sm:border-t-0">
          <p className="text-2xl font-semibold">
            {average ? average.toFixed(1) : "—"}
          </p>
          <p className="text-xs text-muted">{d.media.averageRating}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-3">
        <Button variant="primary" onClick={() => setShowAdd((value) => !value)}>
          {d.media.addEntry}
        </Button>
        {jellyfinConfigured && (
          <Button disabled={pending} onClick={syncJellyfin}>
            {d.media.syncJellyfin}
          </Button>
        )}
        <Button disabled={pending} onClick={() => fileRef.current?.click()}>
          {d.media.importList}
        </Button>
        <a
          href="/api/media/watch-history"
          className="rounded-control border border-line px-3 py-2 text-sm font-medium hover:bg-raised"
        >
          {d.media.exportList}
        </a>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            void importFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        {jellyfinConfigured && jellyfinProfiles.length > 0 && <Select className="ml-auto min-w-40" value={jellyfinUserId} onChange={(event) => chooseJellyfinProfile(event.target.value)} disabled={pending}>{jellyfinProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</Select>}
      </div>
      {message && (
        <div
          role="status"
          className="rounded-control border border-line bg-raised px-3 py-2 text-sm"
        >
          {message}
        </div>
      )}
      {showAdd && (
        <div className="grid gap-2 rounded-card border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-6">
          <Input
            value={manual.title}
            onChange={(event) =>
              setManual({ ...manual, title: event.target.value })
            }
            placeholder={d.media.titleField}
            className="lg:col-span-2"
          />
          <Select
            value={manual.kind}
            onChange={(event) =>
              setManual({ ...manual, kind: event.target.value })
            }
          >
            <option value="movie">{d.media.movies}</option>
            <option value="tv">{d.media.series}</option>
          </Select>
          <Input
            value={manual.year}
            onChange={(event) =>
              setManual({
                ...manual,
                year: event.target.value.replace(/\D/g, "").slice(0, 4),
              })
            }
            placeholder={d.media.year}
            inputMode="numeric"
          />
          <Input
            type="date"
            value={manual.watchedAt}
            onChange={(event) =>
              setManual({ ...manual, watchedAt: event.target.value })
            }
          />
          <Select
            value={manual.rating}
            onChange={(event) =>
              setManual({ ...manual, rating: event.target.value })
            }
          >
            <option value="">{d.media.noRating}</option>
            {Array.from({ length: 10 }, (_, index) => (
              <option key={index + 1} value={index + 1}>
                {index + 1}/10
              </option>
            ))}
          </Select>
          <div className="flex gap-2 lg:col-span-6">
            <Button
              variant="primary"
              disabled={pending || !manual.title.trim()}
              onClick={addManual}
            >
              {d.common.save}
            </Button>
            <Button onClick={() => setShowAdd(false)}>{d.common.cancel}</Button>
          </div>
        </div>
      )}
      <div className="grid gap-2 rounded-card border border-line bg-surface p-3 sm:grid-cols-[minmax(12rem,1fr)_auto_auto]">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={d.media.searchHistory}
        />
        <Select
          value={kind}
          onChange={(event) => setKind(event.target.value as typeof kind)}
        >
          <option value="all">{d.media.all}</option>
          <option value="movie">{d.media.movies}</option>
          <option value="tv">{d.media.series}</option>
        </Select>
        <Select
          value={sort}
          onChange={(event) => setSort(event.target.value as typeof sort)}
        >
          <option value="recent">{d.media.recentlyWatched}</option>
          <option value="rating">{d.media.rating}</option>
          <option value="title">A–Z</option>
          <option value="year">{d.media.year}</option>
        </Select>
      </div>
      {visible.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((entry) => (
            <article
              key={entry.id}
              className="overflow-hidden rounded-2xl border border-line bg-surface p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-card"
            >
              {editing?.id === entry.id ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold">{entry.title}</p>
                    <Button size="sm" onClick={() => setEditing(null)}>
                      {d.common.cancel}
                    </Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Input
                      type="date"
                      value={dateValue(editing.watchedAt)}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          watchedAt: new Date(
                            `${event.target.value}T12:00:00`,
                          ).toISOString(),
                        })
                      }
                    />
                    <Select
                      value={editing.rating ?? ""}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          rating: Number(event.target.value) || undefined,
                        })
                      }
                    >
                      <option value="">{d.media.noRating}</option>
                      {Array.from({ length: 10 }, (_, index) => (
                        <option key={index + 1} value={index + 1}>
                          {index + 1}/10
                        </option>
                      ))}
                    </Select>
                    <Input
                      type="number"
                      min={1}
                      max={999}
                      value={editing.rewatchCount}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          rewatchCount: Number(event.target.value) || 1,
                        })
                      }
                    />
                  </div>
                  <textarea
                    value={editing.notes}
                    onChange={(event) =>
                      setEditing({ ...editing, notes: event.target.value })
                    }
                    maxLength={4000}
                    rows={3}
                    placeholder={d.media.notes}
                    className="w-full rounded-control border border-line bg-input px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      disabled={pending}
                      onClick={saveEdit}
                    >
                      {d.common.save}
                    </Button>
                    <Button
                      variant="danger"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          if (
                            await deleteWatchEntry(entry.id).then(
                              (result) => result.ok,
                            )
                          ) {
                            onChange((current) =>
                              current.filter((item) => item.id !== entry.id),
                            );
                            setEditing(null);
                          }
                        })
                      }
                    >
                      {d.common.delete}
                    </Button>
                  </div>
                </div>
              ) : (
                  <div className="flex items-start gap-4">
                  {entry.poster ? (
                    <img
                      src={entry.poster}
                      alt=""
                      className="h-28 w-20 shrink-0 rounded-xl object-cover shadow-sm"
                    />
                  ) : (
                    <div className="flex h-28 w-20 shrink-0 items-center justify-center rounded-xl bg-raised text-2xl">
                      {entry.kind === "tv" ? "▣" : "▶"}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{entry.title}</p>
                      {entry.year && (
                        <span className="text-xs text-muted">{entry.year}</span>
                      )}
                      <Badge>
                        {entry.kind === "tv" ? d.media.series : d.media.movies}
                      </Badge>
                      {entry.rating && (
                        <Badge tone="accent">★ {entry.rating}/10</Badge>
                      )}
                      {entry.rewatchCount > 1 && (
                        <Badge>×{entry.rewatchCount}</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {new Date(entry.watchedAt).toLocaleDateString(d.lang)}
                    </p>
                    {entry.notes && (
                      <p className="mt-2 line-clamp-2 text-sm text-muted">
                        {entry.notes}
                      </p>
                    )}
                  </div>
                  <Button size="sm" onClick={() => setEditing(entry)}>
                    {d.common.edit}
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title={d.media.noWatchHistory}
          hint={d.media.noWatchHistoryHint}
        />
      )}
    </section>
  );
}
