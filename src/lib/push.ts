import "server-only";
import webpush from "web-push";
import { prisma, getSetting, setSetting } from "./db";
import { decrypt, encrypt } from "./secretBox";

/**
 * Web push.
 *
 * Telegram is the better channel when it works, but it depends on a network
 * that this household's server demonstrably cannot always reach. A push
 * notification goes through the browser's own service — no proxy, no bot, and
 * on a phone with the panel installed it lands on the lock screen.
 *
 * The VAPID key pair identifies this installation to the push services. It is
 * generated once, on demand, and kept with the other secrets.
 */

type Vapid = { publicKey: string; privateKey: string };

let cached: Vapid | null = null;

export async function vapidKeys(): Promise<Vapid> {
  if (cached) return cached;

  const stored = await getSetting<{ publicKey: string; privateKey: string } | null>("push.vapid", null);
  if (stored?.publicKey && stored.privateKey) {
    cached = { publicKey: stored.publicKey, privateKey: await decrypt(stored.privateKey) };
    return cached;
  }

  // Generated rather than configured: nobody should have to run a command
  // before a notification can be sent.
  const keys = webpush.generateVAPIDKeys();
  await setSetting("push.vapid", { publicKey: keys.publicKey, privateKey: await encrypt(keys.privateKey) });
  cached = keys;
  return keys;
}

/** The public half, which the browser needs in order to subscribe. */
export async function publicKey(): Promise<string> {
  return (await vapidKeys()).publicKey;
}

async function configure(): Promise<void> {
  const keys = await vapidKeys();
  // The subject must be a mailto: or https: URL; push services reject anything
  // else, and there is no address to use that is true for every installation.
  webpush.setVapidDetails("mailto:homeplace@localhost", keys.publicKey, keys.privateKey);
}

export type PushMessage = { title: string; body: string; url?: string; tag?: string; urgent?: boolean };

/**
 * Send to every browser subscribed for these users.
 *
 * A subscription that the push service reports as gone is deleted: browsers
 * expire them routinely, and a table of dead endpoints would make every send
 * slower for no reason.
 */
export async function sendPush(userIds: string[], message: PushMessage): Promise<{ sent: number; failed: number }> {
  const subscriptions = await prisma.pushSubscription.findMany({
    where: userIds.length > 0 ? { userId: { in: userIds } } : {},
  });
  if (subscriptions.length === 0) return { sent: 0, failed: 0 };

  await configure();
  const payload = JSON.stringify(message);
  let sent = 0;
  let failed = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { urgency: message.urgent ? "high" : "normal" }
        );
        sent++;
      } catch (e) {
        failed++;
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.delete({ where: { endpoint: sub.endpoint } }).catch(() => {});
        } else {
          console.error("push failed:", status, e instanceof Error ? e.message : e);
        }
      }
    })
  );

  return { sent, failed };
}

/** Everyone who can act on an alert — admins and the owner. */
export async function alertRecipients(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { disabled: false, role: { in: ["owner", "admin"] } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export async function pushEnabled(): Promise<boolean> {
  return (await prisma.pushSubscription.count()) > 0;
}
