import Link from "next/link";
import { prisma, getSetting } from "@/lib/db";
import { pageUser } from "@/lib/pageUser";
import { atLeast } from "@/lib/auth";
import { dockerHealth } from "@/lib/docker";
import { prometheusHealth } from "@/lib/prometheus";
import { proxmoxHealth } from "@/lib/proxmox";
import { settings as cfg } from "@/lib/config";
import { effectiveOrigin } from "@/lib/origin";
import { integrationStatus, integrationsForDisplay, dockerHostsForDisplay, proxmoxConfig } from "@/lib/integrations";
import { DockerHostsForm } from "./DockerHostsForm";
import { notifiersForDisplay } from "@/lib/notify";
import { NOTIFY_POLICY_KEY, normalizePolicy } from "@/lib/notifyPolicy";
import { dict } from "@/i18n";
import { Card, CardHeader, Badge } from "@/components/ui";
import { ago } from "@/lib/format";
import { PasswordForm } from "./PasswordForm";
import { IntegrationForms } from "./IntegrationForms";
import { RuleForms } from "./RuleForms";
import { ScheduleForms } from "./ScheduleForms";
import { SmartCard } from "./SmartCard";
import { smartConfig } from "@/lib/smart";
import { ServiceForms } from "./ServiceForms";
import { PushCard } from "./PushCard";
import { NotifierForms } from "./NotifierForms";
import { NotifyPolicyForm } from "./NotifyPolicyForm";
import { BackupCard } from "./BackupCard";
import { listBackups } from "@/lib/backup";
import { StatusPageCard } from "./StatusPageCard";
import { normalizeStatusPage, STATUS_PAGE_KEY, EMPTY_STATUS_PAGE } from "@/lib/statusPage";
import { KumaImportCard } from "./KumaImportCard";
import { servicesForDisplay } from "@/lib/services";
import { currentNowPlayingToken } from "@/actions/integrations";

export const dynamic = "force-dynamic";

/**
 * Settings, in sections.
 *
 * One page held everything until it held too much: five integrations, five
 * services, alert rules, four notification routes, accounts. Scrolling past
 * four screens to change a token is not configuration, it is an obstacle.
 *
 * The section is a URL parameter rather than component state, so a particular
 * page can be linked, bookmarked and returned to after a save.
 */
type Section = "integrations" | "services" | "alerts" | "account" | "system";

const SECTIONS: Section[] = ["integrations", "services", "alerts", "account", "system"];

export default async function SettingsPage({ searchParams }: { searchParams: { section?: string } }) {
  const user = await pageUser();
  const d = dict(user.locale);
  const isAdmin = atLeast(user.role, "admin");

  const section: Section = SECTIONS.includes(searchParams.section as Section)
    ? (searchParams.section as Section)
    : "integrations";

  // Only what this section needs is fetched. Health checks are real network
  // requests, and asking Proxmox how it is doing while someone edits their
  // password would be rude to both.
  const needsIntegrations = section === "integrations";
  const status = await integrationStatus();

  const [docker, prom, pve] = needsIntegrations
    ? await Promise.all([
        status.docker ? dockerHealth() : Promise.resolve([]),
        status.prometheus ? prometheusHealth() : Promise.resolve({ ok: false, error: "not configured" }),
        status.proxmox ? proxmoxHealth() : Promise.resolve({ ok: false, error: "not configured" }),
      ])
    : [[], { ok: false }, { ok: false }];

  const labels: Record<Section, string> = {
    integrations: d.settings.integrations,
    services: d.settings.services,
    alerts: d.settings.alerts,
    account: d.settings.account,
    system: d.settings.system,
  };

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-semibold tracking-tight">{d.settings.title}</h1>

      <nav className="flex flex-wrap gap-1 border-b border-line pb-2">
        {SECTIONS.filter((s) => isAdmin || s === "account").map((s) => (
          <Link
            key={s}
            href={`/settings?section=${s}`}
            className={`rounded-control px-3 py-1.5 text-sm font-medium transition-colors ${
              s === section ? "bg-accent/10 text-accent" : "text-muted hover:bg-raised hover:text-text"
            }`}
          >
            {labels[s]}
          </Link>
        ))}
      </nav>

      {section === "integrations" && (
        <IntegrationsSection
          d={d}
          isAdmin={isAdmin}
          status={status}
          docker={docker as { key: string; label: string; ok: boolean; error?: string }[]}
          prom={prom as { ok: boolean; error?: string }}
          pve={pve as { ok: boolean; error?: string }}
          userId={user.id}
        />
      )}

      {section === "services" && isAdmin && <ServicesSection d={d} />}
      {section === "alerts" && isAdmin && <AlertsSection d={d} userId={user.id} />}
      {section === "account" && <AccountSection d={d} user={user} isAdmin={isAdmin} />}
      {section === "system" && isAdmin && <SystemSection d={d} userId={user.id} />}
    </div>
  );
}

// ───────────────────────────── Integrations ──────────────────────────────

async function IntegrationsSection({
  d,
  isAdmin,
  status,
  docker,
  prom,
  pve,
  userId,
}: {
  d: ReturnType<typeof dict>;
  isAdmin: boolean;
  status: Awaited<ReturnType<typeof integrationStatus>>;
  docker: { key: string; label: string; ok: boolean; error?: string }[];
  prom: { ok: boolean; error?: string };
  pve: { ok: boolean; error?: string };
  userId: string;
}) {
  const [display, iconPack, dockerHostsDisplay] = await Promise.all([
    integrationsForDisplay(userId),
    getSetting<boolean>("icons.pack", false),
    dockerHostsForDisplay(),
  ]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{d.settings.configuredIn}</p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {docker.map((host) => (
          <IntegrationCard
            key={host.key}
            name={`${d.settings.integrationDocker} · ${host.label}`}
            configured
            ok={host.ok}
            error={host.error}
            d={d}
          />
        ))}
        {!status.docker && <IntegrationCard name={d.settings.integrationDocker} configured={false} ok={false} d={d} />}
        <IntegrationCard
          name={d.settings.integrationPrometheus}
          configured={status.prometheus}
          ok={prom.ok}
          error={prom.error}
          d={d}
        />
        <IntegrationCard
          name={d.settings.integrationProxmox}
          configured={status.proxmox}
          ok={pve.ok}
          error={pve.error}
          d={d}
        />
      </div>

      {!cfg.allowContainerControl() && <p className="text-xs text-muted">⚠ {d.containers.controlDisabled}</p>}

      {isAdmin && <DockerHostsForm d={d} env={dockerHostsDisplay.env} stored={dockerHostsDisplay.stored} />}

      {isAdmin && (
        <IntegrationForms d={d} display={display} nowPlayingToken="" appUrl={effectiveOrigin()} iconPack={iconPack} />
      )}
    </div>
  );
}

// ─────────────────────────────── Services ────────────────────────────────

async function ServicesSection({ d }: { d: ReturnType<typeof dict> }) {
  const services = await servicesForDisplay();
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{d.settings.servicesHint}</p>
      <ServiceForms d={d} display={services} />
    </div>
  );
}

// ──────────────────────── Alerts and notifications ───────────────────────

async function AlertsSection({ d, userId }: { d: ReturnType<typeof dict>; userId: string }) {
  const [rules, notifiers, pushCount, policyRaw, schedules, smart, pve] = await Promise.all([
    prisma.alertRule.findMany({ orderBy: { createdAt: "asc" } }),
    notifiersForDisplay(),
    prisma.pushSubscription.count({ where: { userId } }),
    getSetting<unknown>(NOTIFY_POLICY_KEY, null),
    prisma.schedule.findMany({ orderBy: { createdAt: "asc" } }),
    smartConfig(),
    proxmoxConfig(),
  ]);

  return (
    <div className="space-y-3">
      <RuleForms d={d} rules={rules} />
      {pve && <SmartCard d={d} config={smart} />}
      <ScheduleForms
        d={d}
        schedules={schedules.map((s) => ({
          id: s.id,
          name: s.name,
          enabled: s.enabled,
          kind: s.kind,
          timeOfDay: s.timeOfDay ?? undefined,
          weekday: s.weekday,
          intervalMinutes: s.intervalMinutes,
          action: s.action,
          hostKey: s.hostKey,
          containerName: s.containerName,
          entityId: s.entityId,
          title: s.title,
          body: s.body,
        }))}
      />
      <NotifyPolicyForm d={d} policy={normalizePolicy(policyRaw)} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <PushCard d={d} count={pushCount} />
        <NotifierForms d={d} ntfy={notifiers.ntfy} webhook={notifiers.webhook} email={notifiers.email} />
      </div>
    </div>
  );
}

// ──────────────────────────────── Account ────────────────────────────────

async function AccountSection({
  d,
  user,
  isAdmin,
}: {
  d: ReturnType<typeof dict>;
  user: { id: string; name: string; login: string | null; email: string | null; role: string; passwordHash: string | null };
  isAdmin: boolean;
}) {
  const roleLabel: Record<string, string> = {
    owner: d.settings.roleOwner,
    admin: d.settings.roleAdmin,
    viewer: d.settings.roleViewer,
  };

  const users = isAdmin ? await prisma.user.findMany({ orderBy: { createdAt: "asc" } }) : [];

  return (
    <div className="space-y-3">
      <Card className="max-w-md p-4">
        <p className="text-sm font-medium">{user.name}</p>
        <p className="text-xs text-muted">
          {user.login ?? user.email} · {roleLabel[user.role] ?? user.role}
        </p>
        {/* SSO-only accounts have no password here; offering the form would be
            a dead end. */}
        {user.passwordHash && (
          <div className="mt-4 border-t border-line pt-4">
            <PasswordForm d={d} />
          </div>
        )}
      </Card>

      <AboutCard d={d} />

      {isAdmin && (
        <Card>
          <CardHeader title={`${d.settings.users} · ${users.length}`} />
          <ul className="divide-y divide-line">
            {users.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{u.name}</p>
                  <p className="truncate text-xs text-muted">{u.login ?? u.email}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {u.disabled && <Badge tone="danger">off</Badge>}
                  <Badge tone={u.role === "owner" ? "ok" : "neutral"}>{roleLabel[u.role] ?? u.role}</Badge>
                  <span className="whitespace-nowrap text-xs text-faint">
                    {u.lastLoginAt ? ago(u.lastLoginAt, d) : d.common.never}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ───────────────────────────────── System ────────────────────────────────

/**
 * The parts that are about the installation rather than about a service: the
 * now-playing token, the icon pack, and export/import of the whole layout.
 */
async function SystemSection({ d, userId }: { d: ReturnType<typeof dict>; userId: string }) {
  const [display, npToken, iconPack, backups, statusRaw, checkable] = await Promise.all([
    integrationsForDisplay(userId),
    currentNowPlayingToken(),
    getSetting<boolean>("icons.pack", false),
    listBackups(),
    getSetting<unknown>(STATUS_PAGE_KEY, EMPTY_STATUS_PAGE),
    prisma.item.findMany({ where: { checkKind: { not: "none" } }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
  ]);

  return (
    <div className="space-y-3">
      <IntegrationForms
        d={d}
        display={display}
        nowPlayingToken={npToken}
        appUrl={effectiveOrigin()}
        iconPack={iconPack}
        only="system"
      />
      <StatusPageCard d={d} initial={normalizeStatusPage(statusRaw)} items={checkable} />
      <KumaImportCard d={d} />
      <BackupCard d={d} initial={backups} />
    </div>
  );
}

function AboutCard({ d }: { d: ReturnType<typeof dict> }) {
  return (
    <Card className="max-w-2xl">
      <CardHeader title={d.settings.about} />
      <div className="space-y-3 p-4 text-sm text-muted">
        <p>{d.settings.aboutDescription}</p>
        <p>{d.settings.dashboardIconsCredit}</p>
        <a
          href="https://github.com/homarr-labs/dashboard-icons"
          target="_blank"
          rel="noreferrer"
          className="inline-flex text-accent hover:underline"
        >
          {d.settings.dashboardIconsLicense}
        </a>
      </div>
    </Card>
  );
}

function IntegrationCard({
  name,
  configured,
  ok,
  error,
  d,
}: {
  name: string;
  configured: boolean;
  ok: boolean;
  error?: string;
  d: ReturnType<typeof dict>;
}) {
  return (
    <Card className="flex items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{name}</p>
        {error && configured && (
          <p className="truncate font-mono text-[11px] text-faint" title={error}>
            {error}
          </p>
        )}
      </div>
      <Badge tone={!configured ? "neutral" : ok ? "ok" : "danger"}>
        {!configured ? d.common.notConfigured : ok ? d.settings.connected : d.settings.failing}
      </Badge>
    </Card>
  );
}
