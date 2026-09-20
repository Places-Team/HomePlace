import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeMobile } from "@/lib/linkMobile";
import { boundedJson } from "@/lib/linkRequest";
import { isRepeat, nextOccurrence } from "@/lib/recurrence";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await authorizeMobile(request, "reminder.manage");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await boundedJson(request);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid reminder request" }, { status: 400 });
  const input = body as Record<string, unknown>;
  const action = input.action;
  if (action === "create") {
    const title = typeof input.title === "string" ? input.title.trim().slice(0, 200) : "";
    const at = typeof input.at === "string" ? new Date(input.at) : new Date(NaN);
    const repeat = typeof input.repeat === "string" && isRepeat(input.repeat) ? input.repeat : "none";
    if (!title || Number.isNaN(at.getTime())) return NextResponse.json({ error: "title and time are required" }, { status: 400 });
    const reminder = await prisma.reminder.create({ data: { userId: auth.device.userId, title, at, repeat } });
    return NextResponse.json({ reminder: { id: reminder.id, title: reminder.title, at: reminder.at.toISOString(), repeat: reminder.repeat } }, { status: 201 });
  }
  const id = typeof input.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(input.id) ? input.id : "";
  if (!id) return NextResponse.json({ error: "invalid reminder id" }, { status: 400 });
  const reminder = await prisma.reminder.findFirst({ where: { id, userId: auth.device.userId } });
  if (!reminder) return NextResponse.json({ error: "reminder not found" }, { status: 404 });
  if (action === "complete") {
    await prisma.reminder.update({
      where: { id },
      data: reminder.repeat === "none"
        ? { done: true }
        : { at: nextOccurrence(reminder.at, reminder.repeat), notifiedAt: null },
    });
    return NextResponse.json({ ok: true });
  }
  if (action === "delete") {
    await prisma.reminder.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "unsupported reminder action" }, { status: 400 });
}
