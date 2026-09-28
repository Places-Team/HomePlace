import "server-only";
import { currentUser } from "./session";
import { authenticateLinkDevice, linkDeviceHasPermission } from "./linkDevices";
import { prisma } from "./db";
import type { MediaLocale } from "./media";

/** A browser session or an explicitly media-enabled paired client. */
export async function linkMediaAccess(request: Request): Promise<{ userId: string; locale: MediaLocale; role: string } | null> {
  if (request.headers.has("authorization")) {
    const device = await authenticateLinkDevice(request);
    if (!device?.userId || !linkDeviceHasPermission(device, "media.request")) return null;
    const user = await prisma.user.findUnique({
      where: { id: device.userId! }, select: { id: true, locale: true, role: true, disabled: true },
    });
    return user && !user.disabled ? { userId: user.id, locale: user.locale === "ru" ? "ru" : "en", role: user.role } : null;
  }
  const user = await currentUser();
  return user ? { userId: user.id, locale: user.locale === "ru" ? "ru" : "en", role: user.role } : null;
}

export function mediaLocale(value: string | null, fallback: MediaLocale): MediaLocale {
  return value === "ru" || value === "en" ? value : fallback;
}
