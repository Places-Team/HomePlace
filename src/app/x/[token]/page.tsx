import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/session";
import { getExchange, recipientView } from "@/lib/exchange";
import { dict } from "@/i18n";
import { ExchangeOpen } from "./ExchangeOpen";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ExchangeLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  const record = await getExchange(token);
  if (!record) notFound();
  const user = await currentUser();
  const d = dict(user?.locale);
  if (record.access === "account" && !user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-5 py-12">
        <h1 className="text-2xl font-semibold">{d.exchange.title}</h1>
        <p className="mt-3 text-muted">{d.exchange.private}</p>
        <a href="/login" className="mt-5 self-start rounded-control bg-accent px-4 py-2 text-sm font-medium text-accent-fg">HomePlace</a>
      </main>
    );
  }
  return <ExchangeOpen token={token} exchange={recipientView(record)} d={d.exchange} />;
}
