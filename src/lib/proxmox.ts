import "server-only";
import { Agent } from "undici";
import { proxmoxConfig } from "./integrations";

/**
 * Proxmox VE, read-only.
 *
 * It answers things no exporter does as directly: which VMs and containers
 * exist and whether they are running, what the physical disks report through
 * SMART, how full each storage is. HomePlace only reads — starting and stopping
 * virtual machines belongs in the Proxmox UI, not in a dashboard tile.
 */

export type PveNode = {
  node: string;
  status: string;
  uptime: number;
  cpu: number;
  maxcpu: number;
  mem: number;
  maxmem: number;
};

export type PveGuest = {
  id: string;
  vmid: number;
  name: string;
  /** qemu | lxc */
  type: string;
  node: string;
  status: string;
  uptime: number;
  cpu: number;
  mem: number;
  maxmem: number;
  maxdisk: number;
};

export type PveDisk = {
  devpath: string;
  model: string;
  size: number;
  /** PASSED | FAILED | UNKNOWN */
  health: string;
  wearout?: number;
  used?: string;
  type: string;
};

export type PveStorage = {
  storage: string;
  node: string;
  type: string;
  total: number;
  used: number;
  avail: number;
  enabled: boolean;
};

/**
 * Home Proxmox installs almost always use the self-signed certificate the
 * installer generated. Verifying it would mean every home lab has to set up a
 * CA before seeing a dashboard, so verification is opt-in through
 * PROXMOX_VERIFY_TLS — a deliberate trade-off for a LAN-only connection.
 */
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

async function pve<T>(path: string): Promise<T | null> {
  const cfg = await proxmoxConfig();
  if (!cfg) return null;
  try {
    const res = await fetch(`${cfg.url}/api2/json${path}`, {
      headers: { authorization: `PVEAPIToken=${cfg.tokenId}=${cfg.tokenSecret}` },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
      // @ts-expect-error — undici's dispatcher option is not in the DOM types.
      dispatcher: cfg.verifyTls ? undefined : insecureAgent,
    });
    if (!res.ok) {
      console.error(`proxmox ${path}: HTTP ${res.status}`);
      return null;
    }
    const body = await res.json();
    return body.data as T;
  } catch (e) {
    console.error(`proxmox ${path} failed:`, e);
    return null;
  }
}

export async function nodes(): Promise<PveNode[]> {
  return (await pve<PveNode[]>("/nodes")) ?? [];
}

/** Every VM and container in the cluster, with live status. */
export async function guests(): Promise<PveGuest[]> {
  const rows = await pve<Record<string, unknown>[]>("/cluster/resources?type=vm");
  if (!rows) return [];
  return rows.map((r) => ({
    id: String(r.id ?? ""),
    vmid: Number(r.vmid ?? 0),
    name: String(r.name ?? ""),
    type: String(r.type ?? ""),
    node: String(r.node ?? ""),
    status: String(r.status ?? "unknown"),
    uptime: Number(r.uptime ?? 0),
    cpu: Number(r.cpu ?? 0),
    mem: Number(r.mem ?? 0),
    maxmem: Number(r.maxmem ?? 0),
    maxdisk: Number(r.maxdisk ?? 0),
  }));
}

/** Physical disks of one node, including the SMART verdict. */
export async function disks(node: string): Promise<PveDisk[]> {
  const rows = await pve<Record<string, unknown>[]>(`/nodes/${encodeURIComponent(node)}/disks/list`);
  if (!rows) return [];
  return rows.map((r) => ({
    devpath: String(r.devpath ?? ""),
    model: String(r.model ?? ""),
    size: Number(r.size ?? 0),
    health: String(r.health ?? "UNKNOWN"),
    wearout: r.wearout === undefined || r.wearout === "N/A" ? undefined : Number(r.wearout),
    used: r.used ? String(r.used) : undefined,
    type: String(r.type ?? ""),
  }));
}

/** The three SMART counters worth watching for a disk about to fail: */
export type DiskSmartCounters = {
  /** id 5 — sectors the drive gave up on and remapped. */
  reallocated: number | null;
  /** id 197 — sectors flagged unstable, awaiting reallocation. */
  pending: number | null;
  /** id 198 — sectors it could not read or remap. */
  uncorrectable: number | null;
  /** id 194/190 — current temperature in °C, null when the drive does not report one. */
  temperature: number | null;
};

/**
 * Read the failing-sector counters from one disk's full SMART report.
 *
 * ATA drives expose them as numbered attributes; NVMe uses a different format
 * with no such ids, so those come back null (the health verdict still applies).
 */
export async function diskSmart(node: string, devpath: string): Promise<DiskSmartCounters> {
  const data = await pve<{ attributes?: Record<string, unknown>[] }>(
    `/nodes/${encodeURIComponent(node)}/disks/smart?disk=${encodeURIComponent(devpath)}`
  );
  const attrs = Array.isArray(data?.attributes) ? data!.attributes! : [];
  const raw = (id: number): number | null => {
    const a = attrs.find((x) => Number(x.id) === id);
    if (!a) return null;
    const v = Number(a.raw ?? a.value);
    return Number.isFinite(v) ? v : null;
  };
  // Temperature's raw is often "40 (Min/Max 21/45)", so pull the leading
  // integer rather than Number()-ing the whole string, and reject values
  // outside a sane range (some drives pack min/max into the raw as a huge
  // number). id 194 is the usual attribute, 190 the airflow-temp fallback.
  const temperature = ((): number | null => {
    for (const id of [194, 190]) {
      const a = attrs.find((x) => Number(x.id) === id);
      if (!a) continue;
      const m = /-?\d+/.exec(String(a.raw ?? a.value ?? ""));
      const t = m ? Number(m[0]) : NaN;
      if (Number.isFinite(t) && t > 0 && t <= 120) return t;
    }
    return null;
  })();
  return { reallocated: raw(5), pending: raw(197), uncorrectable: raw(198), temperature };
}

export async function storages(): Promise<PveStorage[]> {
  const rows = await pve<Record<string, unknown>[]>("/cluster/resources?type=storage");
  if (!rows) return [];
  return rows.map((r) => ({
    storage: String(r.storage ?? ""),
    node: String(r.node ?? ""),
    type: String(r.plugintype ?? r.type ?? ""),
    total: Number(r.maxdisk ?? 0),
    used: Number(r.disk ?? 0),
    avail: Number(r.maxdisk ?? 0) - Number(r.disk ?? 0),
    enabled: r.status === "available",
  }));
}

export type PveGuestStatus = {
  vmid: number;
  name: string;
  status: string;
  uptime: number;
  cpu: number;
  cpus: number;
  mem: number;
  maxmem: number;
  disk: number;
  maxdisk: number;
  diskread: number;
  diskwrite: number;
  netin: number;
  netout: number;
  ha?: unknown;
};

/**
 * Live status of one guest — the numbers Proxmox refreshes every couple of
 * seconds. This is what the "open the VM" view leads with; still read-only,
 * still no start/stop, that belongs in the Proxmox UI.
 */
export async function guestStatus(node: string, type: string, vmid: number): Promise<PveGuestStatus | null> {
  const kind = type === "lxc" ? "lxc" : "qemu";
  const r = await pve<Record<string, unknown>>(
    `/nodes/${encodeURIComponent(node)}/${kind}/${vmid}/status/current`
  );
  if (!r) return null;
  return {
    vmid,
    name: String(r.name ?? ""),
    status: String(r.status ?? "unknown"),
    uptime: Number(r.uptime ?? 0),
    cpu: Number(r.cpu ?? 0),
    cpus: Number(r.cpus ?? 0),
    mem: Number(r.mem ?? 0),
    maxmem: Number(r.maxmem ?? 0),
    disk: Number(r.disk ?? 0),
    maxdisk: Number(r.maxdisk ?? 0),
    diskread: Number(r.diskread ?? 0),
    diskwrite: Number(r.diskwrite ?? 0),
    netin: Number(r.netin ?? 0),
    netout: Number(r.netout ?? 0),
    ha: r.ha,
  };
}

/**
 * The guest's configuration — a flat bag of keys Proxmox writes verbatim
 * (cores, memory, the disk and net lines, the OS type). Returned as-is so the
 * view can pick out what is worth showing without this file knowing every key
 * Proxmox has ever defined.
 */
export async function guestConfig(node: string, type: string, vmid: number): Promise<Record<string, string>> {
  const kind = type === "lxc" ? "lxc" : "qemu";
  const r = await pve<Record<string, unknown>>(`/nodes/${encodeURIComponent(node)}/${kind}/${vmid}/config`);
  if (!r) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(r)) out[k] = typeof v === "string" ? v : String(v);
  return out;
}

export type PveRrdPoint = {
  time: number;
  cpu: number;
  mem: number;
  maxmem: number;
  netin: number;
  netout: number;
  diskread: number;
  diskwrite: number;
};

/**
 * Proxmox's own history for one guest, so the detail view has charts without a
 * Prometheus in the loop. `timeframe` is one of hour/day/week/month/year.
 */
export async function guestRrd(
  node: string,
  type: string,
  vmid: number,
  timeframe = "hour"
): Promise<PveRrdPoint[]> {
  const kind = type === "lxc" ? "lxc" : "qemu";
  const rows = await pve<Record<string, unknown>[]>(
    `/nodes/${encodeURIComponent(node)}/${kind}/${vmid}/rrddata?timeframe=${encodeURIComponent(timeframe)}&cf=AVERAGE`
  );
  if (!rows) return [];
  return rows.map((r) => ({
    time: Number(r.time ?? 0) * 1000,
    cpu: Number(r.cpu ?? 0) * 100,
    mem: Number(r.mem ?? 0),
    maxmem: Number(r.maxmem ?? 0),
    netin: Number(r.netin ?? 0),
    netout: Number(r.netout ?? 0),
    diskread: Number(r.diskread ?? 0),
    diskwrite: Number(r.diskwrite ?? 0),
  }));
}

export async function proxmoxHealth(): Promise<{ ok: boolean; error?: string }> {
  const cfg = await proxmoxConfig();
  if (!cfg) return { ok: false, error: "not configured" };
  const data = await pve<unknown>("/version");
  return data ? { ok: true } : { ok: false, error: "request failed — see server logs" };
}
