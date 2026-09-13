import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { DASHBOARD_ICONS_REF, DASHBOARD_ICONS_REPOSITORY, dashboardIconSlugs } from "@/lib/icons";

const CATALOG_URL = `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@${DASHBOARD_ICONS_REF}/tree.json`;

/**
 * The icon picker reads the upstream catalogue through HomePlace so browsers
 * need only one trusted origin. Next keeps the successful response for a day;
 * the revision itself is immutable until HomePlace deliberately updates it.
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ icons: [] }, { status: 401 });

  try {
    const response = await fetch(CATALOG_URL, { next: { revalidate: 86_400 } });
    if (!response.ok) throw new Error(`catalogue returned HTTP ${response.status}`);

    const icons = dashboardIconSlugs(await response.json());
    if (icons.length === 0) throw new Error("catalogue contains no valid PNG icons");

    return NextResponse.json(
      { icons, source: DASHBOARD_ICONS_REPOSITORY, revision: DASHBOARD_ICONS_REF },
      { headers: { "cache-control": "private, max-age=3600" } },
    );
  } catch {
    // The online pack is optional. Known services and emoji remain available
    // when this installation has no route to the public internet.
    return NextResponse.json({ icons: [], error: "catalogue unavailable" }, { status: 502 });
  }
}
