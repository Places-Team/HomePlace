import { NextResponse } from "next/server";
import { authorizeMobile } from "@/lib/linkMobile";
import { arrSearch } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeMobile(request, "media.request");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const term = new URL(request.url).searchParams.get("q")?.trim().slice(0, 80) ?? "";
  if (term.length < 2) return NextResponse.json({ results: [] });
  return NextResponse.json({ results: await arrSearch(term) }, { headers: { "cache-control": "no-store" } });
}
