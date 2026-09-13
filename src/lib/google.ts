import "server-only";
import { prisma } from "./db";
import { encrypt, decrypt } from "./secretBox";
import { effectiveOrigin } from "./origin";
import { getSetting, setSetting } from "./db";

/**
 * Linking a Google account, for the calendar widget.
 *
 * Read-only, and only the calendar: the scopes below are the narrowest ones
 * that answer "what is on today". A dashboard has no business being able to
 * write to somebody's calendar, let alone read their mail.
 *
 * The client credentials belong to whoever runs the panel — Google issues them
 * per application, and there is no way for a self-hosted project to ship one.
 * They can go in .env or in the settings page; .env wins, as everywhere else.
 */

const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/userinfo.email"];

export const REDIRECT_PATH = "/api/auth/google/callback";
export const STATE_COOKIE = "hp_google_state";

export type GoogleConfig = { clientId: string; clientSecret: string; source: "env" | "ui" };

export async function googleConfig(): Promise<GoogleConfig | null> {
  const envId = process.env.GOOGLE_CLIENT_ID?.trim();
  const envSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (envId && envSecret) return { clientId: envId, clientSecret: envSecret, source: "env" };

  const stored = await getSetting<{ clientId: string; clientSecret: string } | null>("integration.google", null);
  if (!stored?.clientId || !stored.clientSecret) return null;
  return { clientId: stored.clientId, clientSecret: await decrypt(stored.clientSecret), source: "ui" };
}

export async function saveGoogleConfig(clientId: string, clientSecret: string): Promise<void> {
  if (!clientId.trim()) {
    await setSetting("integration.google", null);
    return;
  }
  const existing = await getSetting<{ clientSecret: string } | null>("integration.google", null);
  await setSetting("integration.google", {
    clientId: clientId.trim(),
    // Empty means "keep the stored one" — the form shows a mask, not the value.
    clientSecret: clientSecret ? await encrypt(clientSecret) : existing?.clientSecret ?? "",
  });
}

/**
 * The redirect URI Google is given, and the one shown in settings to paste into
 * the Google console. Derived from the request, so a panel opened at
 * 192.168.0.68:3200 registers that address rather than whatever APP_URL says.
 *
 * Google compares this string exactly — scheme, host, port and path all have to
 * match what is registered, which is why it is displayed for copying instead of
 * described in prose.
 */
export async function redirectUri(): Promise<string> {
  return `${await effectiveOrigin()}${REDIRECT_PATH}`;
}

export async function authorizeUrl(state: string): Promise<string | null> {
  const cfg = await googleConfig();
  if (!cfg) return null;
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: await redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    // Offline plus a forced consent screen is the only reliable way to be given
    // a refresh token; without one the link dies an hour later.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope: string };

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse | null> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error("google token request failed:", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    return (await res.json()) as TokenResponse;
  } catch (e) {
    console.error("google token request failed:", e);
    return null;
  }
}

/** Finish the sign-in: code → tokens → stored, encrypted, against the user. */
export async function linkAccount(userId: string, code: string): Promise<{ ok: boolean; email?: string; error?: string }> {
  const cfg = await googleConfig();
  if (!cfg) return { ok: false, error: "google is not configured" };

  const token = await tokenRequest({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: await redirectUri(),
    grant_type: "authorization_code",
  });
  if (!token?.refresh_token) {
    return { ok: false, error: "Google did not return a refresh token — revoke the app's access and try again" };
  }

  const email = await fetchEmail(token.access_token);
  const expiresAt = new Date(Date.now() + token.expires_in * 1000);

  await prisma.googleAccount.upsert({
    where: { userId },
    update: {
      email,
      accessToken: await encrypt(token.access_token),
      refreshToken: await encrypt(token.refresh_token),
      expiresAt,
      scope: token.scope,
    },
    create: {
      userId,
      email,
      accessToken: await encrypt(token.access_token),
      refreshToken: await encrypt(token.refresh_token),
      expiresAt,
      scope: token.scope,
    },
  });

  return { ok: true, email };
}

async function fetchEmail(accessToken: string): Promise<string> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return "";
    const body = await res.json();
    return String(body.email ?? "");
  } catch {
    return "";
  }
}

/**
 * A usable access token, refreshing it when it has expired.
 *
 * Refreshed a minute early: a token that expires while the request is in flight
 * fails in a way that looks like a broken link rather than a stale second.
 */
async function accessTokenFor(userId: string): Promise<string | null> {
  const account = await prisma.googleAccount.findUnique({ where: { userId } });
  if (!account) return null;

  if (account.expiresAt.getTime() - 60_000 > Date.now()) return decrypt(account.accessToken);

  const cfg = await googleConfig();
  if (!cfg) return null;

  const token = await tokenRequest({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: await decrypt(account.refreshToken),
    grant_type: "refresh_token",
  });
  if (!token) return null;

  await prisma.googleAccount.update({
    where: { userId },
    data: {
      accessToken: await encrypt(token.access_token),
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
    },
  });
  return token.access_token;
}

export type CalendarEvent = {
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
};

/** The next events from the primary calendar. */
export async function upcomingEvents(userId: string, days = 7, limit = 10): Promise<CalendarEvent[] | null> {
  const token = await accessTokenFor(userId);
  if (!token) return null;

  const params = new URLSearchParams({
    timeMin: new Date().toISOString(),
    timeMax: new Date(Date.now() + days * 86400_000).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(limit),
  });

  try {
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const body = await res.json();

    return (body.items ?? []).map((item: Record<string, any>) => ({
      id: String(item.id),
      summary: String(item.summary ?? ""),
      // All-day events carry a date, timed ones a dateTime — the widget needs
      // to know which, or an all-day event shows up at midnight.
      start: String(item.start?.dateTime ?? item.start?.date ?? ""),
      end: String(item.end?.dateTime ?? item.end?.date ?? ""),
      allDay: !item.start?.dateTime,
      location: item.location ? String(item.location) : undefined,
    }));
  } catch (e) {
    console.error("google calendar request failed:", e);
    return null;
  }
}

export async function linkedAccount(userId: string) {
  return prisma.googleAccount.findUnique({ where: { userId }, select: { email: true, createdAt: true } });
}

export async function unlinkAccount(userId: string): Promise<void> {
  await prisma.googleAccount.deleteMany({ where: { userId } });
}
