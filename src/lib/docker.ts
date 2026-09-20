import "server-only";
import { settings, type DockerHost } from "./config";
import { resolvedDockerHosts } from "./integrations";

/**
 * Docker, over HTTP.
 *
 * HomePlace never touches /var/run/docker.sock directly. Anything that can write
 * to that socket can start a privileged container and own the host, which is a
 * bad thing to hand a web application. The recommended deployment puts a socket
 * proxy in front, allowlisting only the endpoints used here (see
 * docker-compose.yml).
 */

export type Container = {
  id: string;
  name: string;
  image: string;
  /** The local image's config digest ("sha256:…"), for update checks. */
  imageId?: string;
  /** running | exited | paused | created | restarting | dead */
  state: string;
  status: string;
  createdAt: number;
  ports: { internal: number; external?: number; protocol: string }[];
  labels: Record<string, string>;
  networks: string[];
  hostKey: string;
  hostLabel: string;
  /** Compose project and service, when the container was started by compose.
   *  This is what groups twenty containers into the six stacks they belong to. */
  project?: string;
  service?: string;
  /** Docker's own health check, when the image defines one. */
  health?: string;
  /** Guessed or label-provided address to open in the browser. */
  suggestedUrl?: string;
  /** Label-provided display data, if the container declares it. */
  declared?: { title?: string; icon?: string; group?: string; hide?: boolean };
};

type RawContainer = {
  Id: string;
  Names: string[];
  Image: string;
  ImageID?: string;
  State: string;
  Status: string;
  Created: number;
  Health?: string;
  Ports?: { PrivatePort: number; PublicPort?: number; Type: string }[];
  Labels?: Record<string, string>;
  NetworkSettings?: { Networks?: Record<string, unknown> };
};

/** A one-line error from an HTTP failure — HTML error pages stripped to text. */
function httpError(status: number, body: string): string {
  const clean = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return `HTTP ${status}${clean ? `: ${clean.slice(0, 160)}` : ""}`;
}

async function dockerFetch(host: DockerHost, path: string, init?: RequestInit) {
  const res = await fetch(`${host.url}${path}`, {
    ...init,
    cache: "no-store",
    // A hung endpoint must not hang the dashboard; every panel degrades on its own.
    signal: AbortSignal.timeout(6000),
  });
  return res;
}

/**
 * Containers a tile can be attached to.
 *
 * Labels let a container describe how it wants to appear, the same convention
 * other dashboards use, so an existing compose file needs no rewriting:
 *   homeplace.title, homeplace.icon, homeplace.group, homeplace.url,
 *   homeplace.hide = "true"
 */
export async function listContainers(hostKey?: string): Promise<Container[]> {
  const hosts = (await resolvedDockerHosts()).filter((h) => !hostKey || h.key === hostKey);
  const results = await Promise.allSettled(
    hosts.map(async (host) => {
      const res = await dockerFetch(host, "/containers/json?all=1");
      if (!res.ok) throw new Error(`docker ${host.key}: HTTP ${res.status}`);
      const raw = (await res.json()) as RawContainer[];
      return raw.map((c) => toContainer(c, host));
    })
  );

  const out: Container[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") out.push(...r.value);
    else console.error("container listing failed:", r.reason);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function toContainer(c: RawContainer, host: DockerHost): Container {
  const labels = c.Labels ?? {};
  const ports = (c.Ports ?? []).map((p) => ({
    internal: p.PrivatePort,
    external: p.PublicPort,
    protocol: p.Type,
  }));

  return {
    id: c.Id,
    name: (c.Names?.[0] ?? c.Id).replace(/^\//, ""),
    image: c.Image,
    imageId: c.ImageID,
    state: c.State,
    status: c.Status,
    createdAt: c.Created * 1000,
    ports,
    labels,
    networks: Object.keys(c.NetworkSettings?.Networks ?? {}),
    hostKey: host.key,
    hostLabel: host.label,
    project: labels["com.docker.compose.project"],
    service: labels["com.docker.compose.service"],
    // Docker puts the health verdict in the status line ("Up 2 hours
    // (healthy)"), which is the only place the list endpoint reports it.
    health: /\((healthy|unhealthy|health: starting)\)/.exec(c.Status ?? "")?.[1],
    suggestedUrl: labels["homeplace.url"] ?? guessUrl(ports),
    declared: {
      title: labels["homeplace.title"],
      icon: labels["homeplace.icon"],
      group: labels["homeplace.group"],
      hide: labels["homeplace.hide"] === "true",
    },
  };
}

/**
 * A published port is usually the way in, so offer it as a default when adding
 * a tile. Only a guess — the user confirms or replaces it in the add dialog.
 */
function guessUrl(ports: Container["ports"]): string | undefined {
  const published = ports.filter((p) => p.external && p.protocol === "tcp");
  if (published.length === 0) return undefined;
  // Prefer a recognisable web port over a random one.
  const preferred = published.find((p) => [80, 443, 8080, 8000, 3000].includes(p.internal)) ?? published[0];
  const scheme = preferred.internal === 443 ? "https" : "http";
  return `${scheme}://HOST_ADDRESS:${preferred.external}`;
}

export type ContainerAction = "start" | "stop" | "restart";

/**
 * Container control. Refuses when ALLOW_CONTAINER_CONTROL is off, so an
 * installation can be made strictly read-only from .env regardless of what the
 * UI offers.
 */
export async function controlContainer(
  hostKey: string,
  id: string,
  action: ContainerAction
): Promise<{ ok: boolean; error?: string }> {
  if (!settings.allowContainerControl()) {
    return { ok: false, error: "container control is disabled (ALLOW_CONTAINER_CONTROL)" };
  }
  const host = (await resolvedDockerHosts()).find((h) => h.key === hostKey);
  if (!host) return { ok: false, error: `unknown docker host: ${hostKey}` };

  try {
    const res = await dockerFetch(host, `/containers/${encodeURIComponent(id)}/${action}`, { method: "POST" });
    // 204 = done, 304 = already in that state — both are success from the user's side.
    if (res.status === 204 || res.status === 304) return { ok: true };
    // The socket proxy gates start/stop/restart behind their own ALLOW_* flags,
    // separate from POST — a 403 here is almost always that, not Docker itself.
    if (res.status === 403) {
      return { ok: false, error: "blocked by the Docker socket proxy — enable ALLOW_START / ALLOW_STOP / ALLOW_RESTARTS" };
    }
    return { ok: false, error: httpError(res.status, await res.text()) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** "ghcr.io/u/app:v1" → { name: "ghcr.io/u/app", tag: "v1" }. Null name = digest-pinned. */
function splitImage(image: string): { name: string; tag: string } {
  const at = image.indexOf("@");
  const ref = at === -1 ? image : image.slice(0, at);
  const slash = ref.lastIndexOf("/");
  const colon = ref.lastIndexOf(":");
  if (colon > slash) return { name: ref.slice(0, colon), tag: ref.slice(colon + 1) };
  // No tag in the reference: a bare "@sha256:…" pin has nothing to pull against.
  return { name: at === -1 ? ref : "", tag: "latest" };
}

/**
 * Pull the latest image for a tag.
 *
 * The safe half of "update": it fetches the new image but leaves the running
 * container alone, so nothing restarts and Compose stays the owner of the
 * container's shape — the pulled image takes effect on the next `up`. Needs
 * IMAGES enabled on the socket proxy; POST alone is not enough.
 */
export async function pullImage(hostKey: string, image: string): Promise<{ ok: boolean; error?: string }> {
  if (!settings.allowContainerControl()) {
    return { ok: false, error: "container control is disabled (ALLOW_CONTAINER_CONTROL)" };
  }
  const host = (await resolvedDockerHosts()).find((h) => h.key === hostKey);
  if (!host) return { ok: false, error: `unknown docker host: ${hostKey}` };

  const { name, tag } = splitImage(image);
  if (!name) return { ok: false, error: "cannot pull a digest-pinned image" };

  try {
    const res = await fetch(`${host.url}/images/create?fromImage=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`, {
      method: "POST",
      cache: "no-store",
      // A pull is not a dashboard probe — give it real time over a slow link.
      signal: AbortSignal.timeout(300_000),
    });
    if (res.status === 403 || res.status === 404) {
      return { ok: false, error: "the socket proxy blocks image pulls — set IMAGES: 1 on docker-socket-proxy" };
    }
    if (!res.ok) return { ok: false, error: httpError(res.status, await res.text()) };

    // The daemon streams newline-delimited JSON progress; a failure is a line
    // carrying an "error" field, usually the last one.
    const body = await res.text();
    const errLine = body.split("\n").filter(Boolean).reverse().find((l) => l.includes("\"error\""));
    if (errLine) {
      try {
        return { ok: false, error: String((JSON.parse(errLine) as { error?: string }).error ?? "pull failed").slice(0, 200) };
      } catch {
        return { ok: false, error: "pull failed" };
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type ContainerDetail = Container & {
  command: string;
  restartCount: number;
  startedAt: string;
  finishedAt: string;
  restartPolicy: string;
  mounts: { source: string; destination: string; mode: string; type: string }[];
  env: string[];
  // Named differently from Container.health (a single word from the status
  // line): inspect returns the full verdict, and one field cannot be both.
  healthCheck?: { status: string; failingStreak: number };
};

/**
 * Everything Docker knows about one container.
 *
 * Environment variables are deliberately reduced to names: an .env full of API
 * keys is routinely passed to containers, and a dashboard that prints them on
 * a page is a credential leak waiting for someone to share a screenshot.
 */
export async function inspectContainer(hostKey: string, id: string): Promise<ContainerDetail | null> {
  const host = (await resolvedDockerHosts()).find((h) => h.key === hostKey);
  if (!host) return null;

  try {
    const res = await dockerFetch(host, `/containers/${encodeURIComponent(id)}/json`);
    if (!res.ok) return null;
    const raw = (await res.json()) as Record<string, any>;

    const ports: Container["ports"] = [];
    for (const [key, bindings] of Object.entries(raw.NetworkSettings?.Ports ?? {})) {
      const [portPart, protocol] = key.split("/");
      const external = Array.isArray(bindings) && bindings[0]?.HostPort ? Number(bindings[0].HostPort) : undefined;
      ports.push({ internal: Number(portPart), external, protocol: protocol ?? "tcp" });
    }

    const labels: Record<string, string> = raw.Config?.Labels ?? {};
    const name = String(raw.Name ?? id).replace(/^\//, "");

    return {
      id: raw.Id,
      name,
      image: raw.Config?.Image ?? "",
      state: raw.State?.Status ?? "unknown",
      status: raw.State?.Status ?? "",
      createdAt: Date.parse(raw.Created ?? "") || 0,
      ports,
      labels,
      networks: Object.keys(raw.NetworkSettings?.Networks ?? {}),
      hostKey: host.key,
      hostLabel: host.label,
      suggestedUrl: labels["homeplace.url"] ?? guessUrl(ports),
      declared: {
        title: labels["homeplace.title"],
        icon: labels["homeplace.icon"],
        group: labels["homeplace.group"],
        hide: labels["homeplace.hide"] === "true",
      },
      command: [raw.Path, ...(raw.Args ?? [])].filter(Boolean).join(" "),
      restartCount: Number(raw.RestartCount ?? 0),
      startedAt: raw.State?.StartedAt ?? "",
      finishedAt: raw.State?.FinishedAt ?? "",
      restartPolicy: raw.HostConfig?.RestartPolicy?.Name ?? "",
      mounts: (raw.Mounts ?? []).map((m: Record<string, unknown>) => ({
        source: String(m.Source ?? ""),
        destination: String(m.Destination ?? ""),
        mode: String(m.Mode ?? ""),
        type: String(m.Type ?? ""),
      })),
      // Names only — see the note above.
      env: (raw.Config?.Env ?? []).map((line: string) => line.split("=")[0]),
      health: raw.State?.Health?.Status ? String(raw.State.Health.Status) : undefined,
      healthCheck: raw.State?.Health
        ? { status: String(raw.State.Health.Status), failingStreak: Number(raw.State.Health.FailingStreak ?? 0) }
        : undefined,
    };
  } catch (e) {
    console.error("container inspect failed:", e);
    return null;
  }
}

/** Recent log lines for the container detail view. */
export async function containerLogs(hostKey: string, id: string, tail = 200): Promise<string> {
  const host = (await resolvedDockerHosts()).find((h) => h.key === hostKey);
  if (!host) return "";
  const res = await dockerFetch(host, `/containers/${encodeURIComponent(id)}/logs?stdout=1&stderr=1&tail=${tail}`);
  if (!res.ok) return "";
  const buf = Buffer.from(await res.arrayBuffer());
  return stripLogHeaders(buf);
}

export type ContainerStats = { name: string; cpu: number; memory: number; memoryLimit: number };

/**
 * CPU and memory straight from Docker.
 *
 * cAdvisor answers this better and with history, but it is one more thing to
 * run — and the load widget should say something useful on an installation that
 * has nothing but Docker. One request per container, so the list is capped by
 * the caller.
 */
export async function containerStats(hostKey: string, id: string, name: string): Promise<ContainerStats | null> {
  const host = (await resolvedDockerHosts()).find((h) => h.key === hostKey);
  if (!host) return null;

  try {
    // stream=false returns a single sample that already contains the previous
    // reading, which is what makes a percentage possible from one request.
    const res = await fetch(`${host.url}/containers/${encodeURIComponent(id)}/stats?stream=false&one-shot=false`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as Record<string, any>;

    const cpuDelta = (raw.cpu_stats?.cpu_usage?.total_usage ?? 0) - (raw.precpu_stats?.cpu_usage?.total_usage ?? 0);
    const systemDelta = (raw.cpu_stats?.system_cpu_usage ?? 0) - (raw.precpu_stats?.system_cpu_usage ?? 0);
    // Docker reports per-core totals; multiplying by the core count gives the
    // same "200% means two cores" scale people expect from `docker stats`.
    const cores = raw.cpu_stats?.online_cpus ?? raw.cpu_stats?.cpu_usage?.percpu_usage?.length ?? 1;
    const cpu = systemDelta > 0 && cpuDelta > 0 ? (cpuDelta / systemDelta) * cores * 100 : 0;

    // The cache is memory the kernel can reclaim; counting it makes every
    // container look far hungrier than it is.
    const cache = raw.memory_stats?.stats?.inactive_file ?? raw.memory_stats?.stats?.cache ?? 0;
    const memory = Math.max(0, (raw.memory_stats?.usage ?? 0) - cache);

    return { name, cpu, memory, memoryLimit: raw.memory_stats?.limit ?? 0 };
  } catch {
    return null;
  }
}

/** Stats for several containers at once, capped so a busy host is not hammered. */
export async function statsForContainers(
  containers: { id: string; name: string; hostKey: string }[],
  limit = 12,
  concurrency = 8
): Promise<ContainerStats[]> {
  const selected = containers.slice(0, limit);
  const width = Math.max(1, Math.min(concurrency, selected.length || 1));
  const out: ContainerStats[] = [];

  // Docker's one-shot stats responses are sizeable. Parsing dozens in one
  // Promise.all caused a short 100% CPU burst every sampling minute. Small
  // batches trade a few seconds of background latency for a much flatter load.
  for (let offset = 0; offset < selected.length; offset += width) {
    const results = await Promise.allSettled(
      selected.slice(offset, offset + width).map((container) => containerStats(container.hostKey, container.id, container.name))
    );
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) out.push(result.value);
    }
  }

  return out;
}

/**
 * Follow a container's logs.
 *
 * Returns a stream of already-decoded text: Docker multiplexes stdout and
 * stderr with an eight-byte header per frame, and every consumer of this would
 * otherwise have to know that. The caller's AbortSignal is what ends it — when
 * the browser closes the page, the follow stops.
 */
export async function streamLogs(
  hostKey: string,
  id: string,
  tail: number,
  signal: AbortSignal
): Promise<ReadableStream<string> | null> {
  const host = (await resolvedDockerHosts()).find((h) => h.key === hostKey);
  if (!host) return null;

  const res = await fetch(
    `${host.url}/containers/${encodeURIComponent(id)}/logs?stdout=1&stderr=1&follow=1&timestamps=0&tail=${tail}`,
    { cache: "no-store", signal }
  );
  if (!res.ok || !res.body) return null;

  // Typed explicitly: Buffer.concat widens to ArrayBufferLike, which no longer
  // matches the narrower Buffer<ArrayBuffer> that Buffer.alloc infers.
  let carry: Buffer = Buffer.alloc(0);
  return res.body.pipeThrough(
    new TransformStream<Uint8Array, string>({
      transform(chunk, controller) {
        // Frames can be split across chunks, so whatever cannot be decoded yet
        // is carried into the next one.
        carry = Buffer.concat([carry, Buffer.from(chunk)]) as Buffer;
        const { text, rest } = takeFrames(carry);
        carry = rest;
        if (text) controller.enqueue(text);
      },
    })
  );
}

/** Consume as many complete frames as `buf` holds; return the remainder. */
function takeFrames(buf: Buffer): { text: string; rest: Buffer } {

  let offset = 0;
  const parts: string[] = [];

  while (offset + 8 <= buf.length) {
    const type = buf[offset];
    // A container with a TTY writes plain bytes with no framing at all.
    if (type !== 1 && type !== 2) return { text: buf.toString("utf8"), rest: Buffer.alloc(0) };

    const length = buf.readUInt32BE(offset + 4);
    if (offset + 8 + length > buf.length) break;
    parts.push(buf.subarray(offset + 8, offset + 8 + length).toString("utf8"));
    offset += 8 + length;
  }

  return { text: parts.join(""), rest: buf.subarray(offset) };
}

/**
 * Docker multiplexes stdout and stderr into one stream with an 8-byte header per
 * frame. Without stripping it, every line starts with control bytes.
 */
function stripLogHeaders(buf: Buffer): string {
  const parts: string[] = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    const type = buf[i];
    // Frames start with 0x01/0x02; anything else means the stream is not
    // multiplexed (TTY containers) — take the rest verbatim.
    if (type !== 1 && type !== 2) return buf.toString("utf8");
    const len = buf.readUInt32BE(i + 4);
    parts.push(buf.subarray(i + 8, i + 8 + len).toString("utf8"));
    i += 8 + len;
  }
  return parts.join("");
}

/** Is each configured endpoint reachable? Used by the health/settings page. */
export async function dockerHealth(): Promise<{ key: string; label: string; ok: boolean; error?: string }[]> {
  return Promise.all(
    (await resolvedDockerHosts()).map(async (host) => {
      try {
        const res = await dockerFetch(host, "/_ping");
        return { key: host.key, label: host.label, ok: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` };
      } catch (e) {
        return { key: host.key, label: host.label, ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    })
  );
}
