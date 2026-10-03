export const MAX_BATCH_FILES = 100;
export function parseBatchManifest(value: unknown, limit: number) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_BATCH_FILES) return null;
  const names = new Set<string>();
  const files: { filename: string; mimeType: string; size: number; sha256: string }[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || typeof raw.filename !== "string" || !Number.isSafeInteger(raw.size) || raw.size < 1 || raw.size > limit || typeof raw.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(raw.sha256)) return null;
    let name = raw.filename.split(/[\\/]/).pop()!.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, "_").slice(0, 160).replace(/[. ]+$/g, "") || "file";
    while (Buffer.byteLength(name, "utf8") > 200) name = [...name].slice(0, -1).join("");
    if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) name = `_${name}`;
    const original = name;
    let n = 1;
    while (names.has(name.toLowerCase())) name = `${++n}-${original}`;
    names.add(name.toLowerCase());
    files.push({ filename: name, mimeType: typeof raw.mimeType === "string" && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(raw.mimeType) ? raw.mimeType.slice(0, 120) : "application/octet-stream", size: raw.size, sha256: raw.sha256.toLowerCase() });
  }
  return files;
}
export function batchProgress(files: { size: number; uploadedBytes: number; downloadedBytes?: number; received: boolean }[]) {
  return {
    totalBytes: files.reduce((n, f) => n + f.size, 0),
    uploadedBytes: files.reduce((n, f) => n + Math.min(f.size, Math.max(0, f.uploadedBytes)), 0),
    receivedBytes: files.reduce((n, f) => n + (f.received ? f.size : 0), 0),
    downloadedBytes: files.reduce((n, f) => n + (f.received ? f.size : Math.min(f.size, Math.max(0, f.downloadedBytes ?? 0))), 0),
    totalFiles: files.length, receivedFiles: files.filter(f => f.received).length,
  };
}
