import "server-only";
import { currentUser } from "./session";
import { authorizeMobile } from "./linkMobile";
import { appUrl, settings } from "./config";
import { isSameOriginRequest } from "./security";

export async function exchangeActor(request: Request, mutation: boolean): Promise<{ userId: string } | null> {
  if (request.headers.get("authorization")) {
    const auth = await authorizeMobile(request, "share.relay");
    return auth.ok ? { userId: auth.device.userId } : null;
  }
  const user = await currentUser();
  if (!user || (mutation && !isSameOriginRequest(request.headers, appUrl(), settings.trustProxyHeaders()))) return null;
  return { userId: user.id };
}

export async function canOpenExchange(request: Request, access: string): Promise<boolean> {
  return access === "link" || !!(await exchangeActor(request, false));
}
