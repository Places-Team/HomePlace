import test from "node:test";
import assert from "node:assert/strict";
import { parseBatchManifest, batchProgress } from "../src/lib/linkBatchPolicy";

test("batch manifests reject oversized, unverified and empty files", () => {
  assert.equal(parseBatchManifest([], 100), null);
  assert.equal(parseBatchManifest([{ filename: "a", size: 101, sha256: "a".repeat(64) }], 100), null);
  assert.equal(parseBatchManifest([{ filename: "a", size: 1 }], 100), null);
});
test("batch names are portable, flat and unique", () => {
  const files = parseBatchManifest(["../CON.txt", "../CON.txt", "a:b?.txt"].map(filename => ({ filename, size: 1, sha256: "a".repeat(64) })), 100)!;
  assert.equal(files.length, 3);
  assert.equal(new Set(files.map(f => f.filename)).size, 3);
  for (const file of files) assert.doesNotMatch(file.filename, /[\\/:?]/);
  assert.ok(files[0].filename.startsWith("_CON"));
});
test("batch progress counts only verified files as downloaded", () => {
  assert.deepEqual(batchProgress([{ size: 100, uploadedBytes: 60, downloadedBytes: 10, received: false }, { size: 20, uploadedBytes: 20, received: true }]), { totalBytes: 120, uploadedBytes: 80, receivedBytes: 20, downloadedBytes: 30, totalFiles: 2, receivedFiles: 1 });
});
