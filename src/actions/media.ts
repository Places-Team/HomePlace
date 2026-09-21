"use server";

import { revalidatePath } from "next/cache";
import { requireRole, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  haMediaPlayers,
  haMediaCommand,
  haMediaSet,
  haMediaSay,
  type HaMediaPlayer,
  type MediaCommand,
} from "@/lib/services";
import {
  controlDownload,
  addRawMediaRelease,
  createMediaRequest,
  deleteMediaRequest,
  discoverMedia,
  discoverMediaDetails,
  jellyfinDetails,
  jellyfinPlayedItems,
  jellyfinProfiles,
  listMediaRequests,
  mediaQualityProfiles,
  mediaAutomationTasks,
  mediaServiceIssues,
  searchRawMediaReleases,
  updateMediaRequest,
  type JellyfinDetails,
  type MediaDetailsData,
  type MediaQualityProfile,
  type MediaKind,
  type RawReleaseSearch,
} from "@/lib/media";
import {
  parseWatchHistory,
  recordWatch,
  removeWatch,
  updateWatch,
  type WatchEntryView,
} from "@/lib/watchHistory";

export type MediaResult = {
  ok: boolean;
  error?: string;
  players?: HaMediaPlayer[];
};

export async function readJellyfinDetails(
  id: string,
): Promise<{ ok: boolean; details?: JellyfinDetails; error?: string }> {
  const user = await requireUser();
  const details = await jellyfinDetails(id, user.jellyfinUserId ?? undefined);
  return details
    ? { ok: true, details }
    : { ok: false, error: "Jellyfin did not return this item" };
}

function watchInput(input: {
  jellyfinId?: string;
  kind: string;
  title: string;
  year?: number;
  poster?: string;
  watchedAt?: string;
  rating?: number;
  notes?: string;
  rewatchCount?: number;
}) {
  const title = input.title.trim().slice(0, 240);
  const watchedAt = new Date(input.watchedAt ?? new Date().toISOString());
  if (!title || Number.isNaN(watchedAt.getTime())) return null;
  const rating =
    input.rating === undefined ? undefined : Math.round(Number(input.rating));
  return {
    jellyfinId: input.jellyfinId?.trim().slice(0, 128) || undefined,
    kind: input.kind === "tv" ? ("tv" as const) : ("movie" as const),
    title,
    year:
      input.year && input.year >= 1880 && input.year <= 2200
        ? Math.round(input.year)
        : undefined,
    poster: input.poster?.slice(0, 1000),
    watchedAt: watchedAt.toISOString(),
    rating: rating && rating >= 1 && rating <= 10 ? rating : undefined,
    notes: input.notes?.slice(0, 4000),
    rewatchCount: Math.max(
      1,
      Math.min(999, Math.round(input.rewatchCount ?? 1)),
    ),
  };
}

export async function addWatchEntry(
  input: Parameters<typeof watchInput>[0],
): Promise<{ ok: boolean; entry?: WatchEntryView; error?: string }> {
  const user = await requireUser();
  const normalized = watchInput(input);
  if (!normalized) return { ok: false, error: "invalid watch entry" };
  return { ok: true, entry: await recordWatch(user.id, normalized) };
}

export async function editWatchEntry(
  id: string,
  input: {
    watchedAt: string;
    rating?: number;
    notes: string;
    rewatchCount: number;
  },
) {
  const user = await requireUser();
  const watchedAt = new Date(input.watchedAt);
  const rating =
    input.rating === undefined ? undefined : Math.round(Number(input.rating));
  if (
    Number.isNaN(watchedAt.getTime()) ||
    (rating !== undefined && (rating < 1 || rating > 10))
  )
    return { ok: false, error: "invalid watch entry" };
  const entry = await updateWatch(user.id, id, {
    watchedAt: watchedAt.toISOString(),
    rating,
    notes: input.notes.slice(0, 4000),
    rewatchCount: Math.max(
      1,
      Math.min(999, Math.round(input.rewatchCount || 1)),
    ),
  });
  return entry
    ? { ok: true, entry }
    : { ok: false, error: "watch entry not found" };
}

export async function deleteWatchEntry(id: string) {
  const user = await requireUser();
  return { ok: await removeWatch(user.id, id) };
}

export async function syncJellyfinWatchHistory(): Promise<{
  ok: boolean;
  entries?: WatchEntryView[];
  imported?: number;
  error?: string;
}> {
  const user = await requireUser();
  if (!user.jellyfinUserId)
    return { ok: false, error: "Choose your Jellyfin profile first" };
  const items = await jellyfinPlayedItems(user.jellyfinUserId);
  if (items.length === 0)
    return { ok: false, error: "Jellyfin did not return watched items" };
  const entries: WatchEntryView[] = [];
  for (const item of items) {
    entries.push(
      await recordWatch(
        user.id,
        {
          jellyfinId: item.id,
          kind: item.kind,
          title: item.title,
          year: item.year,
          poster: item.poster,
          watchedAt: item.lastPlayedAt ?? new Date().toISOString(),
        },
        "jellyfin",
      ),
    );
  }
  return { ok: true, entries, imported: entries.length };
}

export async function selectJellyfinProfile(profileId: string) {
  const user = await requireUser();
  const profiles = await jellyfinProfiles();
  const profile = profiles.find((item) => item.id === profileId);
  if (!profile) return { ok: false, error: "Jellyfin profile not found" };
  await prisma.user.update({
    where: { id: user.id },
    data: { jellyfinUserId: profile.id },
  });
  revalidatePath("/media");
  return { ok: true };
}

export async function importWatchHistory(text: string): Promise<{
  ok: boolean;
  entries?: WatchEntryView[];
  imported?: number;
  error?: string;
}> {
  const user = await requireUser();
  try {
    const rows = parseWatchHistory(text);
    const entries: WatchEntryView[] = [];
    for (const row of rows)
      entries.push(await recordWatch(user.id, row, "import"));
    return { ok: true, entries, imported: entries.length };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message.slice(0, 300) : "invalid file",
    };
  }
}

export async function readMediaPlayers(ids?: string[]): Promise<MediaResult> {
  await requireUser();
  const players = await haMediaPlayers(ids);
  if (!players) return { ok: false, error: "home assistant did not answer" };
  return { ok: true, players };
}

export async function sendMediaCommand(
  entityId: string,
  command: MediaCommand,
): Promise<MediaResult> {
  await requireRole("admin");
  const result = await haMediaCommand(entityId, command);
  if (!result.ok) return result;
  return { ok: true, players: (await refreshedPlayer(entityId)) ?? undefined };
}

export async function setMediaValue(
  entityId: string,
  what: "volume" | "seek" | "source",
  value: number | string,
): Promise<MediaResult> {
  await requireRole("admin");
  const result = await haMediaSet(entityId, what, value);
  if (!result.ok) return result;
  return { ok: true, players: (await refreshedPlayer(entityId)) ?? undefined };
}

export async function sendMediaPhrase(
  entityId: string,
  service: string,
  phrase: string,
): Promise<MediaResult> {
  await requireRole("admin");
  const result = await haMediaSay(entityId, service, phrase);
  if (!result.ok) return result;
  return { ok: true, players: (await refreshedPlayer(entityId)) ?? undefined };
}

async function refreshedPlayer(
  entityId: string,
): Promise<HaMediaPlayer[] | null> {
  await new Promise((resolve) => setTimeout(resolve, 400));
  return haMediaPlayers([entityId]);
}

export async function searchMedia(input: {
  query?: string;
  kind?: "all" | MediaKind;
  page?: number;
}) {
  await requireUser();
  return discoverMedia({
    query: input.query?.trim().slice(0, 120),
    kind: input.kind === "movie" || input.kind === "tv" ? input.kind : "all",
    page: Math.max(1, Math.min(100, Number(input.page) || 1)),
  });
}

export async function readMediaServiceIssues() {
  await requireUser();
  return mediaServiceIssues();
}

export async function readMediaAutomationTasks() {
  await requireUser();
  return mediaAutomationTasks();
}

export async function readMediaDetails(
  kind: MediaKind,
  id: number,
): Promise<{
  ok: boolean;
  details?: MediaDetailsData;
  profiles?: MediaQualityProfile[];
  error?: string;
}> {
  await requireUser();
  const [details, profiles] = await Promise.all([
    discoverMediaDetails(kind, id),
    mediaQualityProfiles(kind),
  ]);
  return details
    ? { ok: true, details, profiles }
    : { ok: false, error: "Media details are unavailable" };
}

export async function requestMedia(input: {
  kind: MediaKind;
  mediaId: number;
  seasons?: number[];
  is4k?: boolean;
  serverId?: number;
  profileId?: number;
  rootFolder?: string;
}) {
  await requireRole("admin");
  let normalized = input;
  if (input.serverId !== undefined || input.profileId !== undefined) {
    const profile = (await mediaQualityProfiles(input.kind)).find(
      (item) =>
        item.serverId === Number(input.serverId) &&
        item.profileId === Number(input.profileId),
    );
    if (!profile)
      return {
        ok: false,
        error: "The selected quality profile is no longer available",
      };
    normalized = {
      ...input,
      serverId: profile.serverId,
      profileId: profile.profileId,
      rootFolder: profile.rootFolder,
      is4k: profile.is4k,
    };
  }
  const result = await createMediaRequest(normalized);
  if (result.ok) revalidatePath("/media");
  return result.ok
    ? { ...result, requests: await listMediaRequests() }
    : result;
}

export async function cancelMediaRequest(id: number) {
  await requireRole("admin");
  const result = await deleteMediaRequest(Math.floor(Number(id)));
  if (result.ok) revalidatePath("/media");
  return result;
}

export async function decideMediaRequest(
  id: number,
  decision: "approve" | "decline",
) {
  await requireRole("admin");
  const result = await updateMediaRequest(Math.floor(Number(id)), decision);
  if (result.ok) revalidatePath("/media");
  return result;
}

export async function manageDownload(
  hash: string,
  action: "pause" | "resume" | "recheck" | "delete",
  deleteFiles = false,
) {
  await requireRole("admin");
  const result = await controlDownload(hash, action, deleteFiles);
  if (result.ok) revalidatePath("/media");
  return result;
}

export async function searchProwlarrReleases(input: {
  kind: MediaKind;
  query: string;
  title: string;
  originalTitle?: string;
  season?: number;
}): Promise<RawReleaseSearch> {
  await requireUser();
  return searchRawMediaReleases({
    kind: input.kind,
    query: input.query.trim().slice(0, 160),
    title: input.title.trim().slice(0, 240),
    originalTitle: input.originalTitle?.trim().slice(0, 240),
    season: Math.max(1, Math.min(999, Math.floor(Number(input.season) || 1))),
  });
}

export async function sendProwlarrRelease(input: {
  kind: MediaKind;
  query: string;
  releaseId: string;
}) {
  await requireRole("admin");
  const result = await addRawMediaRelease(input);
  if (result.ok) revalidatePath("/media");
  return result;
}
