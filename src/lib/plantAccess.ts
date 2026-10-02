import "server-only";
import { authorizeMobile } from "./linkMobile";
import { currentUser } from "./session";
import { isSameOriginRequest } from "./security";
import { appUrl, settings } from "./config";

export async function authorizePlantRequest(
  request: Request,
): Promise<
  | { ok: true; userId: string; rateKey: string }
  | { ok: false; error: string; status: number }
> {
  if (request.headers.has("authorization")) {
    const auth = await authorizeMobile(request, "plants.manage");
    return auth.ok
      ? { ok: true, userId: auth.device.userId, rateKey: auth.device.id }
      : auth;
  }
  const user = await currentUser();
  if (!user)
    return { ok: false, status: 401, error: "authentication required" };
  if (
    request.method !== "GET" &&
    !isSameOriginRequest(
      request.headers,
      appUrl(),
      settings.trustProxyHeaders(),
    )
  )
    return { ok: false, status: 403, error: "invalid request origin" };
  return { ok: true, userId: user.id, rateKey: `plant-user:${user.id}` };
}
