"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { prisma, getSetting, setSetting } from "@/lib/db";
import { HOME_CONFIG_KEY, normalizeHome, type HomeConfig } from "@/lib/homeConfig";
import { NOTIFY_POLICY_KEY, normalizePolicy, type NotifyPolicy } from "@/lib/notifyPolicy";
import { httpBaseUrlError } from "@/lib/outbound";
import {
  saveJellyfin,
  saveOverseerr,
  saveQbit,
  saveArr,
  savePbs,
  saveHa,
  jellyfinState,
  overseerrAvailable,
  jellyfinConnectionProbes,
  qbitState,
  arrState,
  pbsState,
  haStates,
  haToggle,
  haSetState,
  arrSearch,
  arrAdd,
  type ArrResult,
  haLight,
  haHistory,
  type HaHistoryPoint,
  type JellyfinSettings,
  type OverseerrSettings,
  type QbitSettings,
  type ArrInstance,
  type PbsSettings,
  type HaSettings,
} from "@/lib/services";

/**
 * Configuring the household's services, and the one action that changes
 * something outside HomePlace: flipping a Home Assistant switch.
 *
 * Every save is followed by a real read, so "saved" means "and it answered".
 */

export type ServiceResult = { ok: boolean; error?: string };

export async function saveJellyfinSettings(input: JellyfinSettings): Promise<ServiceResult> {
  await requireRole("admin");
  const invalid = httpBaseUrlError(input.url) || (input.localUrl ? httpBaseUrlError(input.localUrl) : null);
  if (invalid) return { ok: false, error: invalid };
  if (input.appUrl && (!/^[a-z][a-z0-9+.-]*:/i.test(input.appUrl) || input.appUrl.length > 512)) {
    return { ok: false, error: "the app address must be a valid URL or deep link" };
  }
  await saveJellyfin(input.url || input.localUrl ? input : null);
  revalidatePath("/settings");
  revalidatePath("/");
  if (!input.url && !input.localUrl) return { ok: true };
  if (await jellyfinState()) return { ok: true };
  const probes = await jellyfinConnectionProbes();
  if (probes.some((probe) => probe.publicStatus === 200 && [401, 403].includes(probe.authenticatedStatus))) {
    return { ok: false, error: "settings.jellyfinKeyRejected" };
  }
  if (probes.some((probe) => probe.authenticatedStatus === 200 && probe.sessionsStatus !== 200)) {
    return { ok: false, error: "settings.jellyfinSessionsRejected" };
  }
  if (probes.some((probe) => probe.publicStatus === 200)) {
    return { ok: false, error: "settings.jellyfinAuthUnavailable" };
  }
  return { ok: false, error: "settings.jellyfinNoAnswer" };
}

export async function saveOverseerrSettings(input: OverseerrSettings): Promise<ServiceResult> {
  await requireRole("admin");
  const invalid = httpBaseUrlError(input.url);
  if (invalid) return { ok: false, error: invalid };
  await saveOverseerr(input.url ? input : null);
  revalidatePath("/settings");
  revalidatePath("/media");
  if (!input.url) return { ok: true };
  return (await overseerrAvailable())
    ? { ok: true }
    : { ok: false, error: "no answer — check the address and the API key" };
}

export async function saveQbitSettings(input: QbitSettings): Promise<ServiceResult> {
  await requireRole("admin");
  const invalid = httpBaseUrlError(input.url);
  if (invalid) return { ok: false, error: invalid };
  await saveQbit(input.url ? input : null);
  revalidatePath("/settings");
  revalidatePath("/");
  if (!input.url) return { ok: true };
  return (await qbitState()) ? { ok: true } : { ok: false, error: "no answer — check the address, user and password" };
}

export async function saveArrSettings(instances: ArrInstance[]): Promise<ServiceResult> {
  await requireRole("admin");
  const invalid = instances.map((instance) => httpBaseUrlError(instance.url)).find(Boolean);
  if (invalid) return { ok: false, error: invalid };
  await saveArr(instances);
  revalidatePath("/settings");
  revalidatePath("/");
  const state = await arrState();
  return state.length === instances.filter((i) => i.url).length
    ? { ok: true }
    : { ok: false, error: "one of them did not answer — check its address and API key" };
}

export async function savePbsSettings(input: PbsSettings): Promise<ServiceResult> {
  await requireRole("admin");
  const invalid = httpBaseUrlError(input.url);
  if (invalid) return { ok: false, error: invalid };
  await savePbs(input.url ? input : null);
  revalidatePath("/settings");
  revalidatePath("/");
  if (!input.url) return { ok: true };
  return (await pbsState()) ? { ok: true } : { ok: false, error: "no answer — check the address and the token" };
}

export async function saveHaSettings(input: HaSettings): Promise<ServiceResult> {
  await requireRole("admin");
  const invalid = httpBaseUrlError(input.url);
  if (invalid) return { ok: false, error: invalid };
  await saveHa(input.url ? input : null);
  revalidatePath("/settings");
  revalidatePath("/");
  if (!input.url) return { ok: true };
  return (await haStates()) ? { ok: true } : { ok: false, error: "no answer — check the address and the token" };
}

/** Entities to choose from when configuring the widget. */
/**
 * Discovery for the widget's entity picker.
 *
 * Returns the state as well as the name, so the list is recognisable: two lamps
 * called "Ceiling" are told apart by one being on.
 */
export async function discoverHaEntities(): Promise<{
  ok: boolean;
  error?: string;
  entities: { id: string; name: string; state: string; domain: string; toggleable: boolean }[];
}> {
  await requireRole("admin");
  const entities = await haStates();
  if (!entities) {
    return { ok: false, error: "Home Assistant is not configured, or did not answer", entities: [] };
  }
  return {
    ok: true,
    entities: entities.map((e) => ({
      id: e.id,
      name: e.name,
      state: e.state,
      domain: e.domain,
      toggleable: e.toggleable,
    })),
  };
}

export async function listHaEntities(): Promise<{ id: string; name: string; domain: string }[]> {
  await requireRole("admin");
  const entities = await haStates();
  return (entities ?? []).map((e) => ({ id: e.id, name: e.name, domain: e.domain }));
}

/**
 * Flip a switch. Requires the admin role — a viewer may watch the house, not
 * operate it.
 */
export async function toggleEntity(entityId: string): Promise<ServiceResult> {
  await requireRole("admin");
  const result = await haToggle(entityId);
  revalidatePath("/");
  return result;
}

/** Detailed light control: brightness and colour temperature, not only on/off. */
export async function setLight(
  entityId: string,
  opts: { on?: boolean; brightnessPct?: number; colorTempK?: number; rgb?: [number, number, number] }
): Promise<ServiceResult> {
  await requireRole("admin");
  const result = await haLight(entityId, opts);
  revalidatePath("/");
  return result;
}

/** One entity's recent history from Home Assistant, for the device panel. */
export async function entityHistory(entityId: string): Promise<HaHistoryPoint[]> {
  await requireRole("admin");
  return haHistory(entityId);
}

/** Search Sonarr/Radarr for a title to add. */
export async function searchArr(term: string): Promise<ArrResult[]> {
  await requireRole("admin");
  return arrSearch(term);
}

/** Add a found title to its Sonarr/Radarr library. */
export async function addToArr(instanceLabel: string, externalId: number): Promise<ServiceResult> {
  await requireRole("admin");
  return arrAdd(instanceLabel, externalId);
}

/**
 * What the Home-groups widget's picker can show. In "area" mode: the hand-made
 * groups plus the automatic rooms ("area:<name>"). In "device" mode: the
 * physical devices ("device:<name>") — so a widget can be pinned to one device,
 * a washing machine's dozen sensors shown as a single tile. The keys match the
 * widget's own bucket keys, so no group has to be built first.
 */
export async function listHomeGroups(mode: "area" | "device" = "area"): Promise<{ id: string; name: string; icon?: string }[]> {
  await requireRole("admin");
  const entities = (await haStates()) ?? [];

  if (mode === "device") {
    const devices = [...new Set(entities.map((e) => e.device).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));
    return devices.map((dv) => ({ id: `device:${dv}`, name: dv, icon: "🔌" }));
  }

  const config = normalizeHome(await getSetting(HOME_CONFIG_KEY, null));
  const groups = config.groups.map((g) => ({ id: g.id, name: g.name, icon: g.icon }));
  const areas = [...new Set(entities.map((e) => e.area).filter((a): a is string => !!a))].sort((a, b) => a.localeCompare(b));
  const rooms = areas.map((a) => ({ id: `area:${a}`, name: a, icon: "🏠" }));
  return [...groups, ...rooms];
}

/** Turn a whole group of entities on or off in one call. */
export async function setGroupState(entityIds: string[], on: boolean, groupName?: string): Promise<ServiceResult> {
  const user = await requireRole("admin");
  const result = await haSetState(entityIds, on);
  // A group command is worth a line in the feed — "kitchen turned off" is
  // exactly what you look for when a light is not where you left it.
  await prisma.event.create({
    data: {
      type: "command",
      severity: "info",
      title: groupName ? `${groupName}: ${on ? "on" : "off"}` : on ? "on" : "off",
      detail: result.ok ? `${entityIds.length}` : result.error ?? null,
      actor: user.name,
    },
  });
  revalidatePath("/home");
  revalidatePath("/");
  return result;
}

/** Save the household notification policy — what reaches a phone, and what does not. */
export async function saveNotifyPolicy(policy: NotifyPolicy): Promise<void> {
  await requireRole("admin");
  await setSetting(NOTIFY_POLICY_KEY, normalizePolicy(policy));
  revalidatePath("/settings");
}

/**
 * Save the smart-home layer: hand-made groups, per-entity value formats and
 * name overrides. The client owns the whole shape and hands it back in one
 * call; it is normalised here so a malformed payload cannot poison the setting
 * the home page reads on every load.
 */
export async function saveHomeConfig(config: HomeConfig): Promise<void> {
  await requireRole("admin");
  await setSetting(HOME_CONFIG_KEY, normalizeHome(config));
  revalidatePath("/home");
  revalidatePath("/");
}
