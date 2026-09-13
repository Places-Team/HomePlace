import { redirect } from "next/navigation";
import { needsSetup } from "@/lib/auth";
import { currentUser } from "@/lib/session";
import { settings } from "@/lib/config";
import { dict, lookup } from "@/i18n";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await needsSetup()) redirect("/setup");
  if (await currentUser()) redirect("/");

  const d = dict(settings.defaultLocale());
  const query = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-5 py-12">
      <div className="mb-7">
        <p className="mb-1 font-mono text-xs uppercase tracking-widest text-muted">HomePlace</p>
        <h1 className="text-2xl font-semibold tracking-tight">{d.auth.signIn}</h1>
      </div>

      <LoginForm d={d} initialError={lookup(d, query.error)} />
    </main>
  );
}
