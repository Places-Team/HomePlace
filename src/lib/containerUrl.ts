/** Resolve Docker's suggested web link only after the browser host is known. */
export function containerOpenUrl(template: string | undefined, browserHost?: string): string | null {
  if (!template || (template.includes("HOST_ADDRESS") && !browserHost)) return null;

  try {
    const url = new URL(template.replaceAll("HOST_ADDRESS", browserHost ?? ""));
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}
