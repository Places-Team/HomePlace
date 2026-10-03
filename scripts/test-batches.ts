import assert from "node:assert/strict";
import { prisma } from "../src/lib/db";
import { createBatch, getBatch, changeBatch } from "../src/lib/linkBatches";
import { beginUpload, appendUploadChunk, finishUpload } from "../src/lib/linkResumableUploads";
import { openFileTransfer } from "../src/lib/linkFiles";
import { createHash } from "node:crypto";
import { GET as listBatches, POST as startBatch } from "../src/app/api/link/mobile/share/batches/route";

async function main() {
  assert.match(process.env.DATABASE_URL ?? "", /^file:\/(?:private\/)?tmp\/homeplace-plants-[A-Za-z0-9]{6}\/test.db$/);
  assert.equal((await listBatches(new Request("http://localhost/api/link/mobile/share/batches"))).status, 401);
  assert.equal((await startBatch(new Request("http://localhost/api/link/mobile/share/batches", { method: "POST", body: "{}" }))).status, 401);
  const user = await prisma.user.create({ data: { name: "Batch tests" } });
  const foreign = await prisma.user.create({ data: { name: "Foreign account" } });
  async function device(userId: string, name: string) {
    const capabilities = JSON.stringify(["share.send", "file.receive", "file.batch.receive"].map(name => ({ name, version: 1, constraints: {} })));
    const row = await prisma.linkDevice.create({ data: { name, platform: "linux", platformVersion: "test", appVersion: "test", publicKey: "test", userId, credentialHash: name, capabilities, approvedCapabilities: capabilities, permissions: JSON.stringify(["share.relay"]) } });
    return { ...row, userId };
  }
  const sender = await device(user.id, "sender");
  const receiver = await device(user.id, "receiver");
  const outsider = await device(foreign.id, "outsider");
  const bytes = Buffer.from("batch integrity test");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const manifest = [0, 1].map(() => ({ filename: "../CON.txt", mimeType: "text/plain", size: bytes.length, sha256 }));
  assert.equal(await createBatch(sender, outsider.id, manifest), null);
  const batch = (await createBatch(sender, receiver.id, manifest, "stable-request-key"))!;
  assert.ok(batch);
  assert.equal((await createBatch(sender, receiver.id, manifest, "stable-request-key"))?.id, batch.id);
  assert.equal(await createBatch(sender, receiver.id, manifest.slice(0, 1), "stable-request-key"), null);
  assert.equal(await changeBatch(batch.id, sender, { action: "publish" }), false);
  assert.equal(await getBatch(batch.id, outsider), null);
  assert.equal(await changeBatch(batch.id, receiver, { action: "accept" }), false);
  const ready: { transferId: string; fileId: string }[] = [];
  for (const file of batch.files) {
    const result = await beginUpload({ source: sender, targetDeviceId: receiver.id, filename: file.filename, mimeType: file.mimeType, size: file.size, batchFileId: file.id });
    assert.ok(!("error" in result));
    if ("error" in result) throw Error(result.error);
    const retry = await beginUpload({ source: sender, targetDeviceId: receiver.id, filename: file.filename, mimeType: file.mimeType, size: file.size, batchFileId: file.id });
    assert.ok(!("error" in retry));
    if (!("error" in retry)) assert.equal(retry.id, result.id);
    const chunk = await appendUploadChunk(result.id, sender.id, 0, bytes);
    assert.ok(!("error" in chunk));
    const committed = await finishUpload(result.id, sender);
    assert.ok(!("error" in committed));
    if ("error" in committed) throw Error(committed.error);
    ready.push({ transferId: committed.transferId, fileId: file.id });
    assert.equal(await openFileTransfer(committed.transferId, receiver.id), null);
  }
  assert.equal(await prisma.linkDeviceEvent.count({ where: { deviceId: receiver.id, kind: "share.offer" } }), 0);
  assert.equal(await changeBatch(batch.id, sender, { action: "publish" }), true);
  assert.equal(await changeBatch(batch.id, sender, { action: "publish" }), true);
  assert.equal(await prisma.linkDeviceEvent.count({ where: { deviceId: receiver.id, kind: "share.offer" } }), 1);
  assert.equal(await changeBatch(batch.id, outsider, { action: "accept" }), false);
  assert.equal(await changeBatch(batch.id, receiver, { action: "accept" }), true);
  assert.equal(await changeBatch(batch.id, receiver, { action: "accept" }), true);
  const download = await openFileTransfer(ready[0].transferId, receiver.id);
  assert.ok(download);
  assert.deepEqual(Buffer.from(await new Response(download.stream).arrayBuffer()), bytes);
  assert.equal(await openFileTransfer(ready[0].transferId, outsider.id), null);
  assert.equal(await changeBatch(batch.id, receiver, { action: "progress", fileId: ready[0].fileId, bytes: 5 }), true);
  assert.equal((await getBatch(batch.id, sender))?.progress.downloadedBytes, 5);
  assert.equal(await changeBatch(batch.id, sender, { action: "progress", fileId: ready[0].fileId, bytes: 5 }), false);
  for (const file of ready) {
    assert.equal(await changeBatch(batch.id, receiver, { action: "received", fileId: file.fileId, size: bytes.length, sha256: "0".repeat(64) }), false);
    assert.equal(await changeBatch(batch.id, receiver, { action: "received", fileId: file.fileId, size: bytes.length, sha256 }), true);
  }
  assert.equal((await getBatch(batch.id, sender))?.status, "completed");
  await prisma.linkDevice.update({ where: { id: receiver.id }, data: { permissions: "[]" } });
  assert.equal(await getBatch(batch.id, receiver), null);
  assert.equal(await openFileTransfer(ready[0].transferId, receiver.id), null);
  await prisma.linkDevice.update({ where: { id: receiver.id }, data: { permissions: '["share.relay"]' } });
  const rejected = (await createBatch(sender, receiver.id, manifest.slice(0, 1)))!;
  const rejectedFile = rejected.files[0];
  const pending = await beginUpload({ source: sender, targetDeviceId: receiver.id, filename: rejectedFile.filename, mimeType: rejectedFile.mimeType, size: rejectedFile.size, batchFileId: rejectedFile.id });
  if ("error" in pending) throw Error(pending.error);
  await appendUploadChunk(pending.id, sender.id, 0, bytes);
  await prisma.linkUploadSession.update({ where: { id: pending.id }, data: { status: "finalizing", finalizingAt: new Date(Date.now() - 61 * 60_000) } });
  const finalized = await finishUpload(pending.id, sender);
  if ("error" in finalized) throw Error(finalized.error);
  assert.equal(await changeBatch(rejected.id, sender, { action: "publish" }), true);
  assert.equal(await changeBatch(rejected.id, receiver, { action: "reject" }), true);
  assert.equal(await changeBatch(rejected.id, receiver, { action: "accept" }), false);
  assert.equal(await openFileTransfer(finalized.transferId, receiver.id), null);
  const corrupt = (await createBatch(sender, receiver.id, [{ ...manifest[0], sha256: "0".repeat(64) }]))!;
  const bad = corrupt.files[0];
  const badUpload = await beginUpload({ source: sender, targetDeviceId: receiver.id, filename: bad.filename, mimeType: bad.mimeType, size: bad.size, batchFileId: bad.id });
  if ("error" in badUpload) throw Error(badUpload.error);
  await appendUploadChunk(badUpload.id, sender.id, 0, bytes);
  const mismatch = await finishUpload(badUpload.id, sender);
  assert.ok("error" in mismatch && mismatch.status === 422);
  assert.equal((await getBatch(corrupt.id, sender))?.files[0].uploadedBytes, bytes.length);
  assert.equal(await changeBatch(corrupt.id, sender, { action: "publish" }), false);
  await prisma.linkDevice.update({ where: { id: sender.id }, data: { revokedAt: new Date() } });
  assert.equal(await getBatch(batch.id, receiver), null);
  console.log("PASS: one offer, recipient-only consent, integrity receipts, recovery and account boundaries.");
}
main().finally(() => prisma.$disconnect());
