import { NextResponse } from "next/server";
import { createLinkPairing } from "@/lib/linkDevices";
import { parseLinkPairRequestDetailed } from "@/lib/linkProtocol";
import { boundedJson, checkPairingRateLimit } from "@/lib/linkRequest";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limit = checkPairingRateLimit(request);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "too many pairing requests" },
      {
        status: 429,
        headers: {
          "cache-control": "no-store",
          "retry-after": String(limit.retryAfterSeconds ?? 60),
        },
      },
    );
  }
  const parsed = parseLinkPairRequestDetailed(await boundedJson(request));
  if (!parsed.request) {
    return NextResponse.json(
      { error: "invalid pairing request", code: parsed.error },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  const pairing = await createLinkPairing(parsed.request);
  return NextResponse.json({ protocol: 1, pairing }, { status: 201, headers: { "cache-control": "no-store" } });
}
