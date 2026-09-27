import { pageUser } from "@/lib/pageUser";
import { dict } from "@/i18n";
import { ExchangeBoard } from "./ExchangeBoard";
import { appUrl } from "@/lib/config";
import { availableFileLimit } from "@/lib/fileUploadPolicy";

export const dynamic = "force-dynamic";

export default async function ExchangePage() {
  const user = await pageUser();
  const d = dict(user.locale);
  let serverOrigin: string | null = null;
  try {
    const url = new URL(appUrl());
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
      serverOrigin = url.origin;
    }
  } catch { /* No configured browser-accessible URL. */ }
  return (
    <div className="mx-auto max-w-5xl space-y-7">
      <header className="border-b border-line pb-5">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{d.exchange.title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{d.exchange.hint}</p>
      </header>
      <ExchangeBoard d={d.exchange} serverOrigin={serverOrigin} maxFileBytes={await availableFileLimit()} />
    </div>
  );
}
