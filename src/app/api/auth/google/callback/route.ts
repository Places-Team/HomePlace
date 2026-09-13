import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/session";
import { effectiveOrigin } from "@/lib/origin";
import { linkAccount, STATE_COOKIE } from "@/lib/google";

export const dynamic = "force-dynamic";

async function back(status: string) {
  const url = new URL("/settings", await effectiveOrigin());
  url.searchParams.set("google", status);
  return NextResponse.redirect(url);
}

/**
 * Return leg of the Google link.
 *
 * The state cookie carries the account it was started for, and it has to match
 * whoever is signed in now — otherwise a link opened in one session could land
 * a calendar on another.
 */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return back("unauthorized");

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return back("denied");

  const code = params.get("code");
  const state = params.get("state");
  const cookieStore = await cookies();
  const cookie = cookieStore.get(STATE_COOKIE)?.value ?? "";
  cookieStore.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });

  const [expectedState, expectedUser] = cookie.split(":");
  if (!code || !state || state !== expectedState || expectedUser !== user.id) return back("state");

  const result = await linkAccount(user.id, code);
  return back(result.ok ? "linked" : "failed");
}
