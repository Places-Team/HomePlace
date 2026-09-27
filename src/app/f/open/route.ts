import { NextResponse } from "next/server";
import { validShortCode } from "@/lib/exchangePolicy";

export function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  if (!validShortCode(code)) return new Response("Invalid code", { status: 400, headers: { "cache-control": "no-store" } });
  return NextResponse.redirect(new URL(`/f/${code}`, request.url), { status: 303, headers: { "cache-control": "no-store" } });
}
