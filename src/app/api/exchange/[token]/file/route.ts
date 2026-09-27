import { canOpenExchange } from "@/lib/exchangeAuth";
import { getExchange, openExchangeFile } from "@/lib/exchange";
import { checkDeviceActionRateLimit } from "@/lib/linkRequest";
import { clientAddress } from "@/lib/security";
import { settings } from "@/lib/config";

export const dynamic = "force-dynamic";
const commonHeaders = { "cache-control": "no-store, no-transform", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" };

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const source = clientAddress(request.headers, settings.trustProxyHeaders());
  if (!checkDeviceActionRateLimit(source, "exchange-download", 120).allowed) {
    return new Response("too many requests", { status: 429, headers: commonHeaders });
  }
  if (request.headers.has("range")) return new Response("range requests are not supported", { status: 416, headers: commonHeaders });
  const record = await getExchange((await context.params).token);
  if (!record || !(await canOpenExchange(request, record.access))) {
    return new Response("exchange unavailable", { status: 404, headers: commonHeaders });
  }
  const file = await openExchangeFile(record);
  if (!file) return new Response("exchange unavailable", { status: 404, headers: commonHeaders });
  return new Response(file.stream, {
    headers: {
      ...commonHeaders,
      "content-type": "application/octet-stream",
      "content-length": String(file.size),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "x-content-type-options": "nosniff",
      "x-homeplace-sha256": file.sha256,
    },
  });
}
