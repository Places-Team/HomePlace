export function isHomeNetworkHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized.endsWith(".local") ||
    (!normalized.includes(".") && !normalized.includes(":")) ||
    /^10\./.test(normalized) ||
    /^192\.168\./.test(normalized) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(normalized) ||
    /^127\./.test(normalized) ||
    /^f[cd][0-9a-f]{2}:/i.test(normalized)
  );
}

export function jellyfinWebLink(base: string, id: string): string {
  return `${base.replace(/\/$/, "")}/web/index.html#!/details?id=${encodeURIComponent(id)}`;
}

export function jellyfinWebBase(options: {
  publicUrl: string;
  localUrl: string;
  preferLocal: boolean;
}): string {
  if (options.preferLocal && options.localUrl) return options.localUrl;
  return options.publicUrl || options.localUrl;
}

export function jellyfinNativeLink(template: string, id: string): string {
  return template.replaceAll("{id}", encodeURIComponent(id));
}
