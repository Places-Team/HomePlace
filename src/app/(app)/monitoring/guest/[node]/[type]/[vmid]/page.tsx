import Link from "next/link";
import { notFound } from "next/navigation";
import { pageUser } from "@/lib/pageUser";
import { proxmoxConfig } from "@/lib/integrations";
import { guestStatus, guestConfig, guestRrd } from "@/lib/proxmox";
import { dict } from "@/i18n";
import { Card, CardHeader, Meter, Badge, StatusDot } from "@/components/ui";
import { HoverChart } from "@/components/HoverChart";
import { AutoRefresh } from "@/components/AutoRefresh";
import { bytes, duration, percent } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * One Proxmox guest, opened from the monitoring table.
 *
 * The table answers "which VMs exist and are they up"; this answers "what is
 * this one made of and what is it doing right now" — cores, memory, the disks
 * and networks it was given, and Proxmox's own recent history so there are
 * charts even where no Prometheus watches the guest. Read-only throughout:
 * starting and stopping a VM stays in the Proxmox UI, on purpose.
 */
export default async function GuestDetailPage({
  params,
}: {
  params: Promise<{ node: string; type: string; vmid: string }>;
}) {
  const user = await pageUser();
  const d = dict(user.locale);
  const route = await params;

  if (!(await proxmoxConfig())) notFound();

  const node = decodeURIComponent(route.node);
  const type = route.type === "lxc" ? "lxc" : "qemu";
  const vmid = Number(route.vmid);
  if (!Number.isFinite(vmid)) notFound();

  const [status, config, rrd] = await Promise.all([
    guestStatus(node, type, vmid),
    guestConfig(node, type, vmid),
    guestRrd(node, type, vmid, "hour"),
  ]);

  if (!status) notFound();

  const running = status.status === "running";
  const cpuPoints = rrd.map((p) => [p.time, p.cpu] as [number, number]);
  const memPoints = rrd.map((p) => [p.time, p.mem] as [number, number]);
  const netInPoints = rrd.map((p) => [p.time, p.netin] as [number, number]);
  const netOutPoints = rrd.map((p) => [p.time, p.netout] as [number, number]);

  // The config is a flat bag; pull out the handful worth leading with, then
  // list the disk and network lines Proxmox numbers (scsi0, net0, mp1…).
  const cores = Number(config.cores ?? 0) * Number(config.sockets ?? 1) || Number(config.cores ?? 0);
  const os = config.ostype ?? config.arch ?? "—";
  const diskLines = Object.entries(config).filter(([k]) => /^(scsi|virtio|ide|sata|rootfs|mp)\d*$/.test(k));
  const netLines = Object.entries(config).filter(([k]) => /^net\d+$/.test(k));

  return (
    <>
      <AutoRefresh seconds={15} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href="/monitoring?host=proxmox" className="text-sm text-muted transition-colors hover:text-text">
          ← {d.monitoring.guestBackLink}
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight">{status.name || `#${vmid}`}</h1>
        <StatusDot kind={running ? "up" : "down"} label={running ? d.status.running : d.status.stopped} />
        <Badge>{type}</Badge>
        <span className="font-mono text-xs text-muted">
          {node} · #{vmid}
        </span>
        {running && <span className="font-mono text-xs text-faint">{duration(status.uptime)}</span>}
      </div>

      {!running && (
        <div className="mb-4 rounded-card border border-line bg-raised px-4 py-3 text-sm text-muted">
          {d.monitoring.guestNotRunning}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* Live status — meters for the three things that fill up. */}
        <Card className="lg:col-span-1">
          <CardHeader title={d.monitoring.guestStatus} />
          <div className="space-y-3 p-4">
            <Meted
              label={`${d.monitoring.cpu}${status.cpus ? ` · ${status.cpus} ${d.monitoring.cores}` : ""}`}
              value={percent(status.cpu * 100, 1)}
              meter={status.cpu * 100}
            />
            <Meted
              label={d.monitoring.memory}
              value={`${bytes(status.mem)} / ${bytes(status.maxmem)}`}
              meter={status.maxmem > 0 ? (status.mem / status.maxmem) * 100 : 0}
            />
            {/* Proxmox reports real disk usage for containers, but not for VMs
                — a VM's guest filesystem is opaque to the host — where `disk`
                comes back as 0. Showing "0 B / 32 GiB" with an empty bar reads
                as a broken meter; for those the honest thing is the size it was
                given. */}
            {status.maxdisk > 0 && status.disk > 0 && (
              <Meted
                label={d.monitoring.guestDisk}
                value={`${bytes(status.disk)} / ${bytes(status.maxdisk)}`}
                meter={(status.disk / status.maxdisk) * 100}
              />
            )}
            {status.maxdisk > 0 && status.disk === 0 && (
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted">{d.monitoring.guestDisk}</span>
                <span className="font-mono text-sm tabular-nums">
                  {bytes(status.maxdisk)} <span className="text-faint">{d.monitoring.allocated}</span>
                </span>
              </div>
            )}
            <dl className="divide-y divide-line pt-1 text-sm">
              <Row label={d.monitoring.netIn} value={bytes(status.netin)} />
              <Row label={d.monitoring.netOut} value={bytes(status.netout)} />
              <Row label={d.monitoring.diskRead} value={bytes(status.diskread)} />
              <Row label={d.monitoring.diskWrite} value={bytes(status.diskwrite)} />
            </dl>
          </div>
        </Card>

        {/* Configuration — what the guest was given. */}
        <Card className="lg:col-span-2">
          <CardHeader title={d.monitoring.guestConfig} />
          <dl className="divide-y divide-line text-sm">
            <Row label={d.monitoring.cores} value={cores ? String(cores) : "—"} />
            <Row label={d.monitoring.memory} value={config.memory ? `${config.memory} MiB` : "—"} />
            <Row label={d.monitoring.guestOs} value={os} />
            {config.boot && <Row label={d.monitoring.guestBoot} value={config.boot} />}
            {diskLines.map(([k, v]) => (
              <Row key={k} label={`${d.monitoring.guestDisk} ${k}`} value={v} mono />
            ))}
            {netLines.map(([k, v]) => (
              <Row key={k} label={`${d.monitoring.guestNet} ${k}`} value={v} mono />
            ))}
          </dl>
        </Card>

        {cpuPoints.length > 1 && (
          <>
            <Card>
              <CardHeader title={d.monitoring.cpu} />
              <div className="p-4">
                <HoverChart d={d} points={cpuPoints} unit="percent" min={0} />
              </div>
            </Card>
            <Card>
              <CardHeader title={d.monitoring.memory} />
              <div className="p-4">
                <HoverChart d={d} points={memPoints} unit="bytes" min={0} tone="ok" />
              </div>
            </Card>
            <Card>
              <CardHeader title={d.monitoring.network} />
              <div className="grid grid-cols-2 gap-4 p-4">
                <div>
                  <p className="mb-1 text-[11px] text-muted">↓ {d.monitoring.netIn}</p>
                  <HoverChart d={d} points={netInPoints} unit="bytesPerSecond" min={0} summary={false} />
                </div>
                <div>
                  <p className="mb-1 text-[11px] text-muted">↑ {d.monitoring.netOut}</p>
                  <HoverChart d={d} points={netOutPoints} unit="bytesPerSecond" min={0} tone="danger" summary={false} />
                </div>
              </div>
            </Card>
          </>
        )}
      </div>
    </>
  );
}

function Meted({ label, value, meter }: { label: string; value: string; meter: number }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs text-muted">{label}</span>
        <span className="font-mono text-sm tabular-nums">{value}</span>
      </div>
      <Meter value={meter} />
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2">
      <dt className="shrink-0 text-xs text-muted">{label}</dt>
      <dd className={`truncate text-xs ${mono ? "font-mono" : "font-mono tabular-nums"}`} title={value}>
        {value}
      </dd>
    </div>
  );
}
