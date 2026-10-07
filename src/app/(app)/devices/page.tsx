import { redirect } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Badge, Card } from "@/components/ui";
import { DevicesIcon } from "@/components/NavIcons";
import { dict } from "@/i18n";
import { prisma } from "@/lib/db";
import { pageUser } from "@/lib/pageUser";
import { atLeast } from "@/lib/auth";
import { PairingActions } from "./DeviceActions";
import { ConnectionQr } from "@/components/link/ConnectionQr";
import { DevicesWorkspace } from "@/components/link/DevicesWorkspace";
import { deviceView, permissionLabel, permissionNames } from "@/lib/deviceWorkspace";
import { effectiveOrigin } from "@/lib/origin";

export const dynamic = "force-dynamic";

export default async function DevicesPage() {
  const user = await pageUser();
  if (!atLeast(user.role, "admin")) redirect("/");
  const d = dict(user.locale);
  const ru = user.locale === "ru";
  const now = Date.now();
  const [pairings, devices, serverUrl] = await Promise.all([
    prisma.linkPairing.findMany({
      where: { status: "pending", expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" },
      select: { id: true, name: true, platform: true, platformVersion: true, code: true, permissions: true },
    }),
    prisma.linkDevice.findMany({
      where: { revokedAt: null }, orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, platform: true, platformVersion: true, appVersion: true,
        userId: true, user: { select: { name: true } }, lastSeenAt: true, createdAt: true,
        capabilities: true, approvedCapabilities: true, permissions: true, allowHouseholdShares: true,
      },
    }),
    effectiveOrigin(),
  ]);

  return <div className="mx-auto max-w-[1440px] space-y-6">
    <AutoRefresh seconds={15} />
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="flex items-center gap-3 text-xl font-semibold tracking-tight"><DevicesIcon className="h-6 w-6 text-muted" />{d.devices.title}</h1>
      <p className="text-sm text-muted">{ru ? "Связи, доступ и действия" : "Connections, access and actions"}</p>
    </header>
    <details className="rounded-card border border-line bg-surface">
      <summary className="cursor-pointer px-5 py-3.5 text-sm font-medium">{d.devices.connectTitle}</summary>
      <div className="flex flex-col gap-5 border-t border-line p-5 sm:flex-row sm:items-center">
        <ConnectionQr value={serverUrl} label={d.devices.scanQr} />
        <div className="min-w-0 flex-1"><p className="max-w-2xl text-sm leading-relaxed text-muted">{d.devices.connectHint}</p>
          <p className="mt-3 text-xs font-medium text-muted">{d.devices.serverAddress}</p>
          <code className="mt-1 block select-all overflow-x-auto rounded-control bg-raised px-3 py-2 text-sm">{serverUrl}</code>
          {serverUrl.startsWith("http://") && <p className="mt-2 text-xs text-warn">{d.devices.httpHint}</p>}
        </div>
      </div>
    </details>
    {pairings.length > 0 && <section className="space-y-3">
      <h2 className="text-sm font-semibold">{d.devices.pending}</h2>
      {pairings.map(pairing => <Card key={pairing.id} className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="font-medium">{pairing.name}</p><p className="mt-1 text-sm text-muted">{pairing.platform} {pairing.platformVersion}</p>
            <p className="mt-3 font-mono text-2xl tracking-[0.25em]">{pairing.code}</p><p className="mt-1 text-xs text-muted">{d.devices.codeHint}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">{permissionNames(pairing.permissions).map(permission => <Badge key={permission}>{permissionLabel(permission, ru)}</Badge>)}</div>
          </div><PairingActions id={pairing.id} d={d} />
        </div>
      </Card>)}
    </section>}
    <DevicesWorkspace devices={devices.map(device => deviceView(device, now))} serverUrl={serverUrl} ru={ru} d={{ common: d.common, devices: d.devices }} />
  </div>;
}
