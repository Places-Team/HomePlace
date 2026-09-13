import Link from "next/link";
import { notFound } from "next/navigation";
import { pageUser } from "@/lib/pageUser";
import { canEdit } from "@/lib/auth";
import { inspectContainer, containerLogs } from "@/lib/docker";
import { settings } from "@/lib/config";
import { prometheusConfig } from "@/lib/integrations";
import { queryRange, Q } from "@/lib/prometheus";
import { dict } from "@/i18n";
import { Card, CardHeader, Badge, StatusDot } from "@/components/ui";
import { TileIcon } from "@/components/TileIcon";
import { HoverChart } from "@/components/HoverChart";
import { ContainerControls } from "@/components/containers/ContainerControls";
import { LiveLogs } from "@/components/containers/LiveLogs";
import { AutoRefresh } from "@/components/AutoRefresh";
import { autoIcon } from "@/lib/icons";
import { ago } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * One container in detail — where the arrow on a tile leads.
 *
 * The dashboard answers "is it up"; this page answers "what is it doing and why
 * did it stop". Everything here is read from Docker at request time, plus the
 * container's own metrics when Prometheus and cAdvisor are around.
 */
export default async function ContainerDetailPage({ params }: { params: Promise<{ host: string; id: string }> }) {
  const user = await pageUser();
  const d = dict(user.locale);
  const editable = canEdit(user);
  const route = await params;

  const container = await inspectContainer(route.host, route.id);
  if (!container) notFound();

  const running = container.state === "running";
  const [logs, cpu, mem] = await Promise.all([
    containerLogs(route.host, route.id, 200),
    (await prometheusConfig()) ? queryRange(Q.containerCpu(container.name), 180, 90) : Promise.resolve([]),
    (await prometheusConfig()) ? queryRange(Q.containerMemory(container.name), 180, 90) : Promise.resolve([]),
  ]);

  return (
    <>
      <AutoRefresh seconds={20} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href="/containers" className="text-sm text-muted transition-colors hover:text-text">
          ← {d.containers.title}
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <TileIcon icon={autoIcon({ name: container.name, image: container.image })} title={container.name} size="lg" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight">{container.name}</h1>
              <StatusDot kind={running ? "up" : "down"} label={running ? d.status.running : d.status.stopped} />
            </div>
            <p className="font-mono text-xs text-muted">{container.image}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {container.suggestedUrl && (
            <a
              href={container.suggestedUrl.replace("HOST_ADDRESS", "")}
              target="_blank"
              rel="noreferrer"
              className="rounded-control border border-line px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-raised hover:text-text"
            >
              ↗
            </a>
          )}
          <ContainerControls
            d={d}
            hostKey={container.hostKey}
            id={container.id}
            name={container.name}
            running={running}
            canEdit={editable}
            controlEnabled={settings.allowContainerControl()}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title={d.containers.details} />
          <dl className="divide-y divide-line text-sm">
            <Row label={d.status.up} value={container.status} />
            <Row label={d.containers.created} value={container.createdAt ? ago(container.createdAt, d) : "—"} />
            <Row label={d.containers.restarts} value={String(container.restartCount)} />
            <Row label={d.containers.restartPolicy} value={container.restartPolicy || "—"} />
            <Row label={d.containers.host} value={container.hostLabel} />
            {container.healthCheck && (
              <Row
                label={d.containers.health}
                value={`${container.healthCheck.status}${container.healthCheck.failingStreak ? ` · ${container.healthCheck.failingStreak}` : ""}`}
              />
            )}
          </dl>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title={d.containers.ports} />
          <div className="flex flex-wrap gap-1.5 p-4">
            {container.ports.length === 0 && <p className="text-sm text-muted">—</p>}
            {container.ports.map((p) => (
              <Badge key={`${p.internal}-${p.external}-${p.protocol}`} tone={p.external ? "accent" : "neutral"}>
                {p.external ? `${p.external}→` : ""}
                {p.internal}/{p.protocol}
              </Badge>
            ))}
          </div>

          <CardHeader title={d.containers.networks} />
          <div className="flex flex-wrap gap-1.5 p-4">
            {container.networks.map((n) => (
              <Badge key={n}>{n}</Badge>
            ))}
          </div>

          <CardHeader title={d.containers.mounts} />
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-line">
                {container.mounts.map((m) => (
                  <tr key={m.destination}>
                    <td className="px-4 py-1.5 font-mono text-muted">{m.source || m.type}</td>
                    <td className="px-4 py-1.5 font-mono">→ {m.destination}</td>
                    <td className="px-4 py-1.5 text-faint">{m.mode}</td>
                  </tr>
                ))}
                {container.mounts.length === 0 && (
                  <tr>
                    <td className="px-4 py-2 text-sm text-muted">—</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {(cpu[0] || mem[0]) && (
          <>
            <Card>
              <CardHeader title={`${d.monitoring.cpu} · 3h`} />
              <div className="p-4">
                {cpu[0] ? (
                  <HoverChart d={d} points={cpu[0].points} unit="percent" min={0} />
                ) : (
                  <p className="text-sm text-muted">{d.widgets.noData}</p>
                )}
              </div>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader title={`${d.monitoring.memory} · 3h`} />
              <div className="p-4">
                {mem[0] ? (
                  <HoverChart d={d} points={mem[0].points} unit="bytes" min={0} tone="ok" />
                ) : (
                  <p className="text-sm text-muted">{d.widgets.noData}</p>
                )}
              </div>
            </Card>
          </>
        )}

        {/* Logs scroll inside their own box and keep following the tail; a
            container that prints long lines must not make the page scroll. */}
        <div className="lg:col-span-3">
          <LiveLogs d={d} hostKey={container.hostKey} id={container.id} name={container.name} initial={logs} />
        </div>

        {container.env.length > 0 && (
          <Card className="lg:col-span-3">
            <CardHeader title={d.containers.env} action={<span className="text-xs text-faint">{d.containers.envHint}</span>} />
            <div className="flex flex-wrap gap-1.5 p-4">
              {container.env.map((name) => (
                <Badge key={name}>{name}</Badge>
              ))}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="truncate font-mono text-xs">{value}</dd>
    </div>
  );
}
