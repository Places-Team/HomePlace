import { NextResponse } from "next/server";
import { createLinkPairing } from "@/lib/linkDevices";
import { parseLinkPairRequest } from "@/lib/linkProtocol";
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
  const input = parseLinkPairRequest(await boundedJson(request));
  if (!input) return NextResponse.json({ error: "invalid pairing request" }, { status: 400 });
  const pairing = await createLinkPairing(input);
  return NextResponse.json({ protocol: 1, pairing }, { status: 201, headers: { "cache-control": "no-store" } });
}
