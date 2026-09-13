import { NextResponse } from "next/server";
import { linkInfo } from "@/lib/linkServer";

export const dynamic = "force-dynamic";

/** Public discovery endpoint used before a device has credentials. */
export async function GET() {
  try {
    return NextResponse.json(await linkInfo(), {
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    console.error("HomePlace Link discovery failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "link discovery unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
