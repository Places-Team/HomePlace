import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { randomBytes } from "node:crypto";
import { prisma } from "./db";
import { settings } from "./config";
import { hasMinimumSecretLength } from "./security";

export const SESSION_COOKIE = "hp_session";

type SessionPayload = {
  uid: string;
  /** Account's token version when the cookie was issued. */
  v?: number;
};

let cachedSecret: Uint8Array | null = null;

/**
 * Signing key for session cookies.
 *
 * AUTH_SECRET from .env is the right way to run this. If it is absent we
 * generate one and keep it in the database instead of refusing to start —
 * "clone it and open it" has to work for a self-hosted project. The generated
 * key lives with the data, so sessions survive restarts but not a wiped volume.
 */
async function secret(): Promise<Uint8Array> {
  if (cachedSecret) return cachedSecret;
  const fromEnv = process.env.AUTH_SECRET?.trim();
  if (fromEnv) {
    if (!hasMinimumSecretLength(fromEnv)) throw new Error("AUTH_SECRET must be at least 32 bytes");
    cachedSecret = new TextEncoder().encode(fromEnv);
    return cachedSecret;
  }
  const row = await prisma.setting.findUnique({ where: { key: "auth.secret" } });
  const stored = row ? storedSecret(row.value) : null;
  if (stored && hasMinimumSecretLength(stored)) {
    cachedSecret = new TextEncoder().encode(stored);
    return cachedSecret;
  }
  const generated = randomBytes(32).toString("hex");
  const winner = await prisma.setting.upsert({
    where: { key: "auth.secret" },
    update: {},
    create: { key: "auth.secret", value: JSON.stringify(generated) },
  });
  const persisted = storedSecret(winner.value);
  if (!persisted || !hasMinimumSecretLength(persisted)) throw new Error("Stored AUTH_SECRET is invalid");
  console.warn(
    "AUTH_SECRET is not set — a key was generated and stored in the database. " +
      "Set AUTH_SECRET in .env for a stable one."
  );
  cachedSecret = new TextEncoder().encode(persisted);
  return cachedSecret;
}

function storedSecret(serialized: string): string | null {
  try {
    const value: unknown = JSON.parse(serialized);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export async function createSession(userId: string): Promise<void> {
  const days = settings.sessionDays();
  const account = await prisma.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } });
  const token = await new SignJWT({ uid: userId, v: account?.tokenVersion ?? 0 } satisfies SessionPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${days}d`)
    .sign(await secret());

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: settings.secureCookies(),
    path: "/",
    maxAge: days * 24 * 60 * 60,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
}

/** The signed-in user, or null. Every server action starts here. */
export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, await secret(), { algorithms: ["HS256"] });
    const uid = (payload as SessionPayload).uid;
    if (!uid) return null;
    const user = await prisma.user.findUnique({ where: { id: uid } });
    if (!user || user.disabled) return null;
    // A cookie issued before the last "sign out everywhere" (or password
    // change) no longer counts, however valid its signature.
    if ((payload as SessionPayload).v !== undefined && (payload as SessionPayload).v !== user.tokenVersion) return null;
    return user;
  } catch {
    // Expired or tampered-with cookie — treat as signed out, not as an error.
    return null;
  }
}
