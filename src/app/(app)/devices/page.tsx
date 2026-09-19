import { redirect } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Badge, Card, EmptyState } from "@/components/ui";
import { dict } from "@/i18n";
import { prisma } from "@/lib/db";
import { ago } from "@/lib/format";
import { pageUser } from "@/lib/pageUser";
import { atLeast } from "@/lib/auth";
import { DeviceActions, PairingActions } from "./DeviceActions";

export const dynamic = "force-dynamic";

export default async function DevicesPage() {
  const user = await pageUser();
  if (!atLeast(user.role, "admin")) redirect("/");
  const d = dict(user.locale);
  const now = Date.now();
  const [pairings, devices] = await Promise.all([
    prisma.linkPairing.findMany({ where: { status: "pending", expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
    prisma.linkDevice.findMany({ where: { revokedAt: null }, orderBy: { createdAt: "desc" } }),
  ]);

  return (
    <div className="space-y-6">
      <AutoRefresh seconds={5} />
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{d.devices.title}</h1>
        <p className="mt-1 text-sm text-muted">{d.devices.intro}</p>
      </div>

      {pairings.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">{d.devices.pending}</h2>
          {pairings.map((pairing) => (
            <Card key={pairing.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-medium">{pairing.name}</p>
                  <p className="text-sm text-muted">{pairing.platform} {pairing.platformVersion}</p>
                  <p className="mt-2 font-mono text-2xl tracking-[0.25em]">{pairing.code}</p>
                  <p className="mt-1 text-xs text-muted">{d.devices.codeHint}</p>
                </div>
                <PairingActions id={pairing.id} d={d} />
              </div>
            </Card>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{d.devices.connected}</h2>
        {devices.length === 0 ? (
          <EmptyState title={d.devices.empty} />
        ) : (
          devices.map((device) => {
            const capabilities = JSON.parse(device.capabilities) as { name?: string }[];
            const online = !!device.lastSeenAt && now - device.lastSeenAt.getTime() < 90_000;
            return (
              <Card key={device.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{device.name}</p>
                      <Badge tone={online ? "ok" : "neutral"}>{online ? d.devices.online : d.devices.offline}</Badge>
                    </div>
                    <p className="text-sm text-muted">{device.platform} {device.platformVersion} · {device.appVersion}</p>
                    <p className="mt-1 text-xs text-muted">
                      {device.lastSeenAt ? `${d.devices.lastSeen} ${ago(device.lastSeenAt, d)}` : d.devices.neverConnected}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {capabilities.map((capability) => capability.name && <Badge key={capability.name}>{capability.name}</Badge>)}
                    </div>
                  </div>
                  <DeviceActions
                    id={device.id}
                    canNotify={capabilities.some((capability) => capability.name === "notification.receive")}
                    d={d}
                  />
                </div>
              </Card>
            );
          })
        )}
      </section>
    </div>
  );
}
