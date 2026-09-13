import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { currentUser } from "@/lib/session";
import { canEdit } from "@/lib/auth";
import { settings } from "@/lib/config";
import { effectiveOrigin } from "@/lib/origin";
import { authorizeUrl, STATE_COOKIE } from "@/lib/google";

export const dynamic = "force-dynamic";

/** Starts linking a Google account to the signed-in user. */
export async function GET() {
  const user = await currentUser();
  if (!canEdit(user)) return NextResponse.redirect(new URL("/settings", await effectiveOrigin()));

  const url = await authorizeUrl("");
  if (!url) return NextResponse.redirect(new URL("/settings?google=unconfigured", await effectiveOrigin()));

  // The state ties the callback to this browser and this account: without it a
  // prepared callback URL could attach an attacker's calendar to someone else.
  const state = randomBytes(16).toString("hex");
  (await cookies()).set(STATE_COOKIE, `${state}:${user!.id}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: settings.secureCookies(),
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect((await authorizeUrl(state))!);
}
