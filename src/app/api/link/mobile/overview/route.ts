import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { upcomingEvents, linkedAccount } from "@/lib/google";
import { telegramConfig } from "@/lib/integrations";
import { authorizeMobile, monitoringSummary } from "@/lib/linkMobile";
import { arrState, qbitState } from "@/lib/services";
import { shareTargets } from "@/lib/linkDevices";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeMobile(request, "dashboard.read");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.device.userId;
  const [reminders, account, calendar, monitoring, arr, qbit, telegram, targets] = await Promise.all([
    prisma.reminder.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, title: true, at: true, repeat: true, done: true, createdAt: true, completedAt: true },
    }),
    linkedAccount(userId),
    upcomingEvents(userId, 45, 120),
    monitoringSummary(),
    arrState(),
    qbitState(),
    telegramConfig(),
    shareTargets(auth.device),
  ]);
  return NextResponse.json({
    serverTime: new Date().toISOString(),
    permissions: JSON.parse(auth.device.permissions) as string[],
    reminders: reminders.map((item) => ({
      ...item,
      at: item.at.toISOString(),
      createdAt: item.createdAt.toISOString(),
      completedAt: item.completedAt?.toISOString() ?? null,
    })),
    calendar: { connected: account !== null, email: account?.email ?? null, events: calendar ?? [] },
    requests: {
      instances: arr,
      qbittorrent: qbit,
    },
    telegram: {
      connected: telegram !== null,
      enabled: telegram?.enabled ?? false,
      source: telegram?.source ?? "none",
    },
    monitoring,
    shareTargets: targets,
  }, { headers: { "cache-control": "no-store" } });
}
