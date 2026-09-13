import { type NextRequest } from "next/server";
import { promises as fs } from "fs";
import { currentUser } from "@/lib/session";
import { backupFile } from "@/lib/backup";

export const dynamic = "force-dynamic";

/**
 * Download one database snapshot.
 *
 * Admins only, and the name is validated to a safe pattern in `backupFile`
 * before it is ever joined to a path — a download endpoint that takes a
 * filename is exactly where a "../" would try to walk out of the folder.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const user = await currentUser();
  if (!user || (user.role !== "admin" && user.role !== "owner")) {
    return new Response("forbidden", { status: 403 });
  }

  const { name } = await params;
  const file = backupFile(name);
  if (!file) return new Response("not found", { status: 404 });

  try {
    const data = await fs.readFile(file);
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
