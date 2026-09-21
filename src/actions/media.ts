"use server";

import { revalidatePath } from "next/cache";
import { requireRole, requireUser } from "@/lib/auth";
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
  createMediaRequest,
  deleteMediaRequest,
  discoverMedia,
  updateMediaRequest,
  type MediaKind,
} from "@/lib/media";

export type MediaResult = { ok: boolean; error?: string; players?: HaMediaPlayer[] };

export async function readMediaPlayers(ids?: string[]): Promise<MediaResult> {
  await requireUser();
  const players = await haMediaPlayers(ids);
  if (!players) return { ok: false, error: "home assistant did not answer" };
  return { ok: true, players };
}

export async function sendMediaCommand(entityId: string, command: MediaCommand): Promise<MediaResult> {
  await requireRole("admin");
  const result = await haMediaCommand(entityId, command);
  if (!result.ok) return result;
  return { ok: true, players: (await refreshedPlayer(entityId)) ?? undefined };
}

export async function setMediaValue(
  entityId: string,
  what: "volume" | "seek" | "source",
  value: number | string
): Promise<MediaResult> {
  await requireRole("admin");
  const result = await haMediaSet(entityId, what, value);
  if (!result.ok) return result;
  return { ok: true, players: (await refreshedPlayer(entityId)) ?? undefined };
}

export async function sendMediaPhrase(entityId: string, service: string, phrase: string): Promise<MediaResult> {
  await requireRole("admin");
  const result = await haMediaSay(entityId, service, phrase);
  if (!result.ok) return result;
  return { ok: true, players: (await refreshedPlayer(entityId)) ?? undefined };
}

async function refreshedPlayer(entityId: string): Promise<HaMediaPlayer[] | null> {
  await new Promise((resolve) => setTimeout(resolve, 400));
  return haMediaPlayers([entityId]);
}

export async function searchMedia(input: { query?: string; kind?: "all" | MediaKind; page?: number }) {
  await requireUser();
  return discoverMedia({
    query: input.query?.trim().slice(0, 120),
    kind: input.kind === "movie" || input.kind === "tv" ? input.kind : "all",
    page: Math.max(1, Math.min(100, Number(input.page) || 1)),
  });
}

export async function requestMedia(input: {
  kind: MediaKind;
  mediaId: number;
  seasons?: number[];
  is4k?: boolean;
}) {
  await requireRole("admin");
  const result = await createMediaRequest(input);
  if (result.ok) revalidatePath("/media");
  return result;
}

export async function cancelMediaRequest(id: number) {
  await requireRole("admin");
  const result = await deleteMediaRequest(Math.floor(Number(id)));
  if (result.ok) revalidatePath("/media");
  return result;
}

export async function decideMediaRequest(id: number, decision: "approve" | "decline") {
  await requireRole("admin");
  const result = await updateMediaRequest(Math.floor(Number(id)), decision);
  if (result.ok) revalidatePath("/media");
  return result;
}

export async function manageDownload(
  hash: string,
  action: "pause" | "resume" | "recheck" | "delete",
  deleteFiles = false
) {
  await requireRole("admin");
  const result = await controlDownload(hash, action, deleteFiles);
  if (result.ok) revalidatePath("/media");
  return result;
}
