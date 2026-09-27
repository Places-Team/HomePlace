import { NextResponse } from "next/server";
import { exchangeActor } from "@/lib/exchangeAuth";
import { createFileExchange } from "@/lib/exchange";
import { EXCHANGE_FILE_LIMIT, parseExchangeOptions } from "@/lib/exchangePolicy";
import { availableFileLimit } from "@/lib/fileUploadPolicy";
import { checkDeviceActionRateLimit } from "@/lib/linkRequest";
import { safeFilename } from "@/lib/linkShare";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };

export async function POST(request: Request) {
  const actor = await exchangeActor(request, true);
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  const rate = checkDeviceActionRateLimit(actor.userId, "exchange-file", 2);
  if (!rate.allowed) return NextResponse.json({ error: "too many file exchanges" }, { status: 429, headers });
  const size = Number(request.headers.get("x-homeplace-size"));
  const announced = request.headers.get("content-length");
  if (!Number.isSafeInteger(size) || size < 1 || size > EXCHANGE_FILE_LIMIT || size > await availableFileLimit() || (announced && Number(announced) !== size)) {
    return NextResponse.json({ error: "invalid file size" }, { status: 413, headers });
  }
  const options = parseExchangeOptions({
    expiresInSeconds: Number(request.headers.get("x-homeplace-expires") || 3600),
    access: request.headers.get("x-homeplace-access") || "link",
    deleteAfterOpen: request.headers.get("x-homeplace-delete-after-open") === "true",
  });
  if (!options || !request.body) return NextResponse.json({ error: "invalid file exchange" }, { status: 400, headers });
  let filename = "shared-file";
  const encoded = request.headers.get("x-homeplace-filename-base64");
  if (encoded && /^[A-Za-z0-9+/]{1,512}={0,2}$/.test(encoded)) {
    filename = safeFilename(Buffer.from(encoded, "base64").toString("utf8"));
  }
  try {
    const exchange = await createFileExchange(actor.userId, {
      filename,
      mimeType: (request.headers.get("content-type") || "application/octet-stream").slice(0, 120),
      size,
      stream: request.body,
    }, options);
    return NextResponse.json({ exchange }, { status: 201, headers });
  } catch (error) {
    if (error instanceof Error && (error.message === "too many active exchanges" || error.message === "exchange storage quota reached")) {
      return NextResponse.json({ error: error.message }, { status: 429, headers });
    }
    if (error instanceof Error && /upload limit|storage/.test(error.message)) {
      return NextResponse.json({ error: "file exceeds server upload limit or available storage" }, { status: 413, headers });
    }
    if (error instanceof Error && /file size|encrypted file size/.test(error.message)) {
      return NextResponse.json({ error: "file size does not match upload" }, { status: 400, headers });
    }
    throw error;
  }
}
