"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword, needsSetup } from "@/lib/auth";
import { createSession, destroySession, currentUser } from "@/lib/session";
import { settings } from "@/lib/config";
import { headers } from "next/headers";
import { checkAttempt, recordFailure, clearAttempts } from "@/lib/rateLimit";
import { clientAddress } from "@/lib/security";

export type FormState = { error?: string; ok?: boolean };

const credentials = z.object({
  login: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
});

/**
 * First-run wizard.
 *
 * Guarded by the user count rather than by a token in .env: the window is open
 * only while the database has no accounts at all, and closes the moment the
 * owner exists. Two people racing to it cannot both win, because the second
 * insert finds a non-empty table.
 */
export async function setupOwner(_prev: FormState, form: FormData): Promise<FormState> {
  if (!(await needsSetup())) return { error: "setup.alreadyDone" };

  const name = String(form.get("name") ?? "").trim();
  const login = String(form.get("login") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const repeat = String(form.get("passwordRepeat") ?? "");

  if (!name || !login) return { error: "common.error" };
  if (password.length < 8) return { error: "setup.passwordTooShort" };
  if (password !== repeat) return { error: "setup.passwordMismatch" };

  const existing = await prisma.user.findUnique({ where: { login } });
  if (existing) return { error: "setup.loginTaken" };

  const user = await prisma.user.create({
    data: {
      name,
      login,
      passwordHash: await hashPassword(password),
      role: "owner",
      locale: settings.defaultLocale(),
      lastLoginAt: new Date(),
    },
  });

  // A brand-new panel with no dashboard has nowhere to put the first tile.
  await prisma.dashboard.create({ data: { name: "Home", order: 0, shared: true, ownerId: user.id } });

  await createSession(user.id);
  redirect("/");
}

export async function signIn(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = credentials.safeParse({
    login: form.get("login"),
    password: form.get("password"),
  });
  if (!parsed.success) return { error: "auth.wrongCredentials" };

  // Limited per login name and per source address together: one wrong password
  // typed twice should not lock out the household, and one address trying every
  // name in turn should still run into the wall.
  const source = clientAddress(await headers(), settings.trustProxyHeaders());
  const key = `${parsed.data.login}|${source}`;
  const limit = checkAttempt(key);
  if (!limit.allowed) return { error: "auth.tooManyAttempts" };

  const user = await prisma.user.findUnique({ where: { login: parsed.data.login } });

  // Same message and roughly the same work whether the login exists or not, so
  // the form cannot be used to enumerate accounts.
  if (!user?.passwordHash) {
    await hashPassword(parsed.data.password);
    recordFailure(key);
    return { error: "auth.wrongCredentials" };
  }
  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
    recordFailure(key);
    await prisma.event.create({
      data: { type: "auth-fail", severity: "warn", title: parsed.data.login, actor: parsed.data.login },
    });
    return { error: "auth.wrongCredentials" };
  }
  if (user.disabled) return { error: "auth.accountDisabled" };

  clearAttempts(key);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await prisma.event.create({ data: { type: "login", title: user.name, actor: user.name } });
  await createSession(user.id);
  redirect("/");
}

export async function signOut(): Promise<void> {
  await destroySession();
  redirect("/login");
}

/** Appearance and language, stored per account. */
export async function updatePreferences(form: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) return;
  const theme = String(form.get("theme") ?? user.theme);
  const accent = String(form.get("accent") ?? user.accent);
  const locale = String(form.get("locale") ?? user.locale);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      theme: ["system", "light", "dark"].includes(theme) ? theme : user.theme,
      accent,
      locale: ["en", "ru"].includes(locale) ? locale : user.locale,
    },
  });
}

export async function changePassword(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user) return { error: "common.error" };
  const current = String(form.get("currentPassword") ?? "");
  const next = String(form.get("newPassword") ?? "");
  if (next.length < 8) return { error: "setup.passwordTooShort" };
  // An SSO-only account has no password to verify against; it also has no
  // password to change here.
  if (!user.passwordHash || !(await verifyPassword(current, user.passwordHash))) {
    return { error: "auth.wrongCredentials" };
  }
  // Changing a password ends every other session — that is what someone means
  // when they change it because they think somebody else has it.
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(next), tokenVersion: { increment: 1 } },
  });
  await createSession(user.id);
  return { ok: true };
}

/**
 * Sign out everywhere.
 *
 * A panel is opened on phones, tablets and a laptop that may be somewhere else
 * entirely; "I do not know where I am still signed in" needs an answer that is
 * not "change your password".
 */
export async function signOutEverywhere(): Promise<void> {
  const user = await currentUser();
  if (!user) return;
  await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });
  await destroySession();
  redirect("/login");
}
