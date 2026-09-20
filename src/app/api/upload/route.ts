import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/session";
import { canEdit } from "@/lib/auth";
import { saveImage } from "@/lib/uploads";
import { appUrl, settings } from "@/lib/config";
import { isSameOriginRequest } from "@/lib/security";

export const dynamic = "force-dynamic";

/**
 * Image upload, for backgrounds and slideshows.
 *
 * A route rather than a server action because the browser's file picker hands
 * back a File, and on a phone that picker is the gallery — which is the whole
 * point: choosing a wallpaper should not require first putting it on a web
 * server somewhere.
 *
 * Admins only, one image per request, type and size checked in saveImage.
 */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!canEdit(user)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isSameOriginRequest(req.headers, appUrl(), settings.trustProxyHeaders())) {
    return NextResponse.json({ error: "invalid request origin" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected a multipart form" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });

  const result = await saveImage(file);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ url: result.url });
}
