import { NextResponse } from "next/server";
import { canOpenExchange, exchangeActor } from "@/lib/exchangeAuth";
import { deleteExchange, getExchange, recipientView } from "@/lib/exchange";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" };
type Context = { params: Promise<{ token: string }> };

export async function GET(request: Request, context: Context) {
  const record = await getExchange((await context.params).token);
  if (!record || !(await canOpenExchange(request, record.access))) {
    return NextResponse.json({ error: "exchange unavailable" }, { status: 404, headers });
  }
  return NextResponse.json({ exchange: recipientView(record) }, { headers });
}

export async function DELETE(request: Request, context: Context) {
  const actor = await exchangeActor(request, true);
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  const deleted = await deleteExchange(actor.userId, (await context.params).token);
  return deleted
    ? NextResponse.json({ ok: true }, { headers })
    : NextResponse.json({ error: "exchange unavailable" }, { status: 404, headers });
}
