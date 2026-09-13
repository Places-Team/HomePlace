import { NextResponse } from "next/server";
import { readStored } from "@/lib/uploads";

/**
 * Serves an uploaded image.
 *
 * Not behind the login: these are wallpapers and slideshow pictures, the file
 * names are content hashes nobody can guess, and requiring a session would
 * break them as CSS backgrounds and in an installed PWA. Nothing private is
 * ever stored here — the upload endpoint accepts images and nothing else.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const file = await readStored(name);
  if (!file) return new NextResponse("not found", { status: 404 });

  // Buffer is a Uint8Array, but the Response types only accept the latter —
  // and copying is not needed, the view shares the same memory.
  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      "content-type": file.type,
      // The name is derived from the contents, so the file behind a URL can
      // never change — cache it for a year.
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
