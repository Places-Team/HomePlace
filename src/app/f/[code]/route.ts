import { getShortExchangeToken } from "@/lib/exchange";
import { checkDeviceActionRateLimit } from "@/lib/linkRequest";
import { clientAddress } from "@/lib/security";
import { settings } from "@/lib/config";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" };

export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  const source = clientAddress(request.headers, settings.trustProxyHeaders());
  if (!checkDeviceActionRateLimit(source, "exchange-short-open", 6).allowed ||
      !checkDeviceActionRateLimit("all", "exchange-short-open", 30).allowed) {
    return new Response("Too many attempts", { status: 429, headers });
  }
  const token = await getShortExchangeToken((await context.params).code);
  if (!token) return new Response("Link unavailable", { status: 404, headers });
  return new Response(null, { status: 303, headers: { ...headers, location: `/x/${token}` } });
}
