import { dict } from "@/i18n";
import { settings } from "@/lib/config";

export default function ExchangeNotFound() {
  const d = dict(settings.defaultLocale());
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-5 py-12">
      <h1 className="text-2xl font-semibold">{d.exchange.title}</h1>
      <p className="mt-3 text-muted">{d.exchange.unavailable}</p>
    </main>
  );
}
