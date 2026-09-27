import { validShortCode } from "@/lib/exchangePolicy";

export function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  if (!validShortCode(code)) return new Response("Invalid code", { status: 400, headers: { "cache-control": "no-store" } });
  return new Response(null, { status: 303, headers: { "cache-control": "no-store", location: `/f/${code}` } });
}
