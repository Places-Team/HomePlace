import { parseLinkCapabilities, type LinkCapability } from "./linkProtocol";

export function withinApprovedCapabilities(approvedJson: string, reported: LinkCapability[]): boolean {
  let approved: LinkCapability[] | null;
  try {
    approved = parseLinkCapabilities(JSON.parse(approvedJson));
  } catch {
    return false;
  }
  const current = parseLinkCapabilities(reported);
  if (!approved || !current) return false;
  const byName = new Map(approved.map((capability) => [capability.name, capability]));
  return current.every((capability) => {
    const original = byName.get(capability.name);
    if (!original || original.version !== capability.version) return false;
    const keys = Object.keys(original.constraints);
    return keys.length === Object.keys(capability.constraints).length
      && keys.every((key) => original.constraints[key] === capability.constraints[key]);
  });
}

export function activeApprovedCapabilities(currentJson: string, approvedJson: string | null | undefined): Set<string> {
  if (approvedJson == null) return new Set();
  try {
    const current = parseLinkCapabilities(JSON.parse(currentJson));
    if (!current || !withinApprovedCapabilities(approvedJson, current)) return new Set();
    return new Set(current.map((capability) => capability.name));
  } catch {
    return new Set();
  }
}

export function canRelayClipboard(capabilitiesJson: string, permissionsJson: string): boolean {
  try {
    const capabilities = parseLinkCapabilities(JSON.parse(capabilitiesJson));
    const permissions: unknown = JSON.parse(permissionsJson);
    return !!capabilities?.some((capability) => capability.name === "clipboard.send")
      && Array.isArray(permissions)
      && permissions.includes("clipboard.relay");
  } catch {
    return false;
  }
}
