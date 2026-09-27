import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { pageUser } from "@/lib/pageUser";
import { atLeast } from "@/lib/auth";
import { dict } from "@/i18n";
import { Badge } from "@/components/ui";
import { DeviceActions } from "@/app/(app)/devices/DeviceActions";
import { SHARE_LIFETIME_MS } from "@/lib/linkShare";

export const dynamic = "force-dynamic";

function offerType(payload: string, labels: { file: string; link: string; text: string }): string {
  try {
    const data = JSON.parse(payload) as { type?: unknown; filename?: unknown };
    if (data.type === "file") return typeof data.filename === "string" ? data.filename.slice(0, 120) : labels.file;
    if (data.type === "url") return labels.link;
    return labels.text;
  } catch {
    return labels.text;
  }
}

function DeviceGlyph({ platform }: { platform: string }) {
  const phone = /android|ios|iphone/i.test(platform);
  return <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-accent/10 text-accent">
    {phone ? <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="7" y="2" width="10" height="20" rx="2.5" /><path d="M10 18h4" /></svg>
      : <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="3" width="20" height="15" rx="2" /><path d="M8 22h8M12 18v4" /></svg>}
  </span>;
}

export default async function TransfersPage() {
  const user = await pageUser();
  if (!atLeast(user.role, "admin")) redirect("/");
  const d = dict(user.locale);
  const devices = await prisma.linkDevice.findMany({
    where: { userId: user.id, revokedAt: null },
    orderBy: [{ lastSeenAt: "desc" }, { name: "asc" }],
  });
  const offers = devices.length ? await prisma.linkDeviceEvent.findMany({
    where: { deviceId: { in: devices.map((device) => device.id) }, kind: "share.offer" },
    orderBy: { createdAt: "desc" },
    take: 30,
  }) : [];
  const names = new Map(devices.map((device) => [device.id, device.name]));
  const now = Date.now();
  const locale = user.locale === "ru" ? "ru-RU" : "en-US";

  return <div className="mx-auto max-w-6xl space-y-8">
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">HomePlace Link</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{d.nav.transfers}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{d.transfers.hint}</p>
      </div>
      <Link href="/devices" className="rounded-control border border-line px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-raised hover:text-text">{d.transfers.manage}</Link>
    </header>

    <section aria-labelledby="transfer-devices-title">
      <h2 id="transfer-devices-title" className="mb-3 text-sm font-semibold text-muted">{d.transfers.myDevices}</h2>
      {devices.length === 0 ? <div className="rounded-card border border-dashed border-line px-5 py-10 text-center text-sm text-muted">{d.transfers.noDevices}</div> :
        <div className="grid gap-3 md:grid-cols-2">
          {devices.map((device) => {
            let capabilities: { name?: string }[] = [];
            let permissions: string[] = [];
            try {
              const parsed: unknown = JSON.parse(device.capabilities);
              if (Array.isArray(parsed)) capabilities = parsed;
            } catch { /* An older device may not report capabilities. */ }
            try {
              const parsed: unknown = JSON.parse(device.permissions);
              if (Array.isArray(parsed)) permissions = parsed.filter((value): value is string => typeof value === "string");
            } catch { /* Keep account management available. */ }
            const has = (name: string) => capabilities.some((capability) => capability.name === name);
            const online = !!device.lastSeenAt && now - device.lastSeenAt.getTime() < 90_000;
            return <article key={device.id} className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 transition-colors hover:border-accent/40">
              <div className="flex items-center gap-3">
                <DeviceGlyph platform={device.platform} />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-semibold">{device.name}</h3>
                  <p className="text-sm text-muted">{device.platform}</p>
                </div>
                <Badge tone={online ? "ok" : "neutral"}>{online ? d.devices.online : d.devices.offline}</Badge>
              </div>
              <DeviceActions id={device.id} canNotify={has("notification.receive")} canOpenUrl={has("url.open")} canReceiveText={has("text.receive")} canReceiveFile={has("file.receive")} allowHouseholdShares={device.allowHouseholdShares} quickSharingEnabled={permissions.includes("share.relay")} compact d={d} />
            </article>;
          })}
        </div>}
    </section>

    <section aria-labelledby="transfer-recent-title">
      <h2 id="transfer-recent-title" className="mb-3 text-sm font-semibold text-muted">{d.transfers.recent}</h2>
      {offers.length === 0 ? <p className="border-t border-line py-6 text-sm text-muted">{d.transfers.noOffers}</p> :
        <ul className="divide-y divide-line border-t border-line">
          {offers.map((offer) => <li key={offer.id} className="flex flex-wrap items-center gap-2 py-3 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium">{offerType(offer.payload, d.devices)}</span>
            <span className="text-muted">{names.get(offer.deviceId)}</span>
            <span className="text-muted">{offer.deliveredAt ? d.transfers.delivered : now - offer.createdAt.getTime() >= SHARE_LIFETIME_MS ? d.transfers.expired : d.transfers.waiting}</span>
            <time dateTime={offer.createdAt.toISOString()} className="w-full font-mono text-xs tabular-nums text-faint sm:w-auto">{offer.createdAt.toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time>
          </li>)}
        </ul>}
    </section>
  </div>;
}
