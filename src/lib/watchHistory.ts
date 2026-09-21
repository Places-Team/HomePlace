import "server-only";

import { prisma } from "./db";

export type WatchEntryView = {
  id: string;
  jellyfinId?: string;
  kind: "movie" | "tv";
  title: string;
  year?: number;
  poster?: string;
  watchedAt: string;
  rating?: number;
  notes: string;
  rewatchCount: number;
  source: string;
};

export type WatchEntryInput = Omit<WatchEntryView, "id" | "source">;

function view(row: {
  id: string;
  jellyfinId: string | null;
  kind: string;
  title: string;
  year: number | null;
  poster: string | null;
  watchedAt: Date;
  rating: number | null;
  notes: string | null;
  rewatchCount: number;
  source: string;
}): WatchEntryView {
  return {
    id: row.id,
    jellyfinId: row.jellyfinId ?? undefined,
    kind: row.kind === "tv" ? "tv" : "movie",
    title: row.title,
    year: row.year ?? undefined,
    poster: row.poster ?? undefined,
    watchedAt: row.watchedAt.toISOString(),
    rating: row.rating ?? undefined,
    notes: row.notes ?? "",
    rewatchCount: row.rewatchCount,
    source: row.source,
  };
}

export async function watchHistory(userId: string): Promise<WatchEntryView[]> {
  const rows = await prisma.watchEntry.findMany({ where: { userId }, orderBy: [{ watchedAt: "desc" }, { title: "asc" }] });
  return rows.map(view);
}

export async function recordWatch(
  userId: string,
  input: Omit<WatchEntryInput, "notes" | "rewatchCount"> & { notes?: string; rewatchCount?: number },
  source = "manual"
): Promise<WatchEntryView> {
  const data = {
    kind: input.kind,
    title: input.title,
    year: input.year ?? null,
    poster: input.poster ?? null,
    watchedAt: new Date(input.watchedAt),
    rating: input.rating ?? null,
    notes: input.notes ?? null,
    rewatchCount: input.rewatchCount ?? 1,
    source,
  };
  const row = input.jellyfinId
    ? await prisma.watchEntry.upsert({
        where: { userId_jellyfinId: { userId, jellyfinId: input.jellyfinId } },
        create: { ...data, userId, jellyfinId: input.jellyfinId },
        update: source === "jellyfin"
          ? { kind: data.kind, title: data.title, year: data.year, poster: data.poster, source }
          : data,
      })
    : await prisma.watchEntry.create({ data: { ...data, userId } });
  return view(row);
}

export async function updateWatch(
  userId: string,
  id: string,
  input: { watchedAt: string; rating?: number; notes: string; rewatchCount: number }
): Promise<WatchEntryView | null> {
  const existing = await prisma.watchEntry.findFirst({ where: { id, userId } });
  if (!existing) return null;
  return view(await prisma.watchEntry.update({
    where: { id },
    data: {
      watchedAt: new Date(input.watchedAt),
      rating: input.rating ?? null,
      notes: input.notes,
      rewatchCount: input.rewatchCount,
    },
  }));
}

export async function removeWatch(userId: string, id: string): Promise<boolean> {
  const result = await prisma.watchEntry.deleteMany({ where: { id, userId } });
  return result.count > 0;
}

export async function watchHistoryExport(userId: string) {
  const entries = await watchHistory(userId);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: entries.map(({ id: _id, source: _source, poster: _poster, ...entry }) => entry),
  };
}

export function parseWatchHistory(text: string): WatchEntryInput[] {
  if (!text.trim() || text.length > 2_000_000) throw new Error("invalid file");
  const parsed = JSON.parse(text) as unknown;
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { entries?: unknown }).entries)
      ? (parsed as { entries: unknown[] }).entries
      : null;
  if (!rows || rows.length > 5000) throw new Error("invalid watch history");

  return rows.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`invalid entry ${index + 1}`);
    const value = raw as Record<string, unknown>;
    const title = String(value.title ?? "").trim().slice(0, 240);
    if (!title) throw new Error(`missing title at entry ${index + 1}`);
    const watchedAt = new Date(String(value.watchedAt ?? new Date().toISOString()));
    if (Number.isNaN(watchedAt.getTime())) throw new Error(`invalid date at entry ${index + 1}`);
    const rating = value.rating === null || value.rating === undefined || value.rating === "" ? undefined : Number(value.rating);
    const year = value.year === null || value.year === undefined || value.year === "" ? undefined : Number(value.year);
    return {
      jellyfinId: typeof value.jellyfinId === "string" ? value.jellyfinId.slice(0, 128) : undefined,
      kind: value.kind === "tv" ? "tv" : "movie",
      title,
      year: year && year >= 1880 && year <= 2200 ? Math.round(year) : undefined,
      watchedAt: watchedAt.toISOString(),
      rating: rating && rating >= 1 && rating <= 10 ? Math.round(rating) : undefined,
      notes: String(value.notes ?? "").slice(0, 4000),
      rewatchCount: Math.max(1, Math.min(999, Math.round(Number(value.rewatchCount) || 1))),
    };
  });
}
