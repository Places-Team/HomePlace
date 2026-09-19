import { NextResponse } from "next/server";
import { claimLinkPairing } from "@/lib/linkDevices";
import { boundedJson } from "@/lib/linkRequest";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const input = await boundedJson(request);
  const claimSecret = input && typeof input === "object" && "claimSecret" in input
    ? (input as { claimSecret?: unknown }).claimSecret
    : null;
  if (typeof claimSecret !== "string") return NextResponse.json({ error: "invalid claim" }, { status: 400 });
  const result = await claimLinkPairing((await context.params).id, claimSecret);
  if (!result) return NextResponse.json({ error: "pairing not found" }, { status: 404 });
  return NextResponse.json({ protocol: 1, pairing: result }, { headers: { "cache-control": "no-store" } });
}
