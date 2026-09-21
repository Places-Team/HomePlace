import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { watchHistoryExport } from "@/lib/watchHistory";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const data = await watchHistoryExport(user.id);
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="homeplace-watch-history-${date}.json"`,
      "cache-control": "no-store",
    },
  });
}
