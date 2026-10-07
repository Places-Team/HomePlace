import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/db";
import {
  createFileExchange,
  createTextExchange,
  deleteExchange,
  getExchange,
  getShortExchangeToken,
  listExchanges,
  openExchangeFile,
  openExchangeText,
} from "../src/lib/exchange";
import { parseExchangeOptions, type ExchangeOptions } from "../src/lib/exchangePolicy";

if (!process.env.DATABASE_URL?.includes("homeplace-exchange-test")) {
  throw new Error("Run this integration test only against a disposable homeplace-exchange-test database");
}

const once: ExchangeOptions = { access: "link", deleteAfterOpen: true, expiresInSeconds: 600 };

test("legacy public one-time payload creates short text and file links with actual quick expiry", async () => {
  const user = await prisma.user.create({ data: { name: "Legacy exchange test" } });
  try {
    const options = parseExchangeOptions({ access: "link", deleteAfterOpen: true, expiresInSeconds: 86400, quick: false });
    assert.ok(options);
    const text = await createTextExchange(user.id, "legacy text", options);
    const bytes = new TextEncoder().encode("driver fixture");
    const file = await createFileExchange(user.id, {
      filename: "driver.bin", mimeType: "application/octet-stream", size: bytes.byteLength,
      stream: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
    }, options);
    for (const exchange of [text, file]) {
      assert.equal(exchange.shortCode?.length, 5);
      assert.equal(exchange.access, "link");
      assert.equal(exchange.deleteAfterOpen, true);
      const remaining = new Date(exchange.expiresAt).getTime() - Date.now();
      assert.ok(remaining > 590000 && remaining <= 600000);
      assert.equal(await getShortExchangeToken(exchange.shortCode!), exchange.token);
    }
    const textRecord = await getExchange(text.token);
    assert.ok(textRecord);
    assert.equal(await openExchangeText(textRecord), "legacy text");
    assert.equal(await getShortExchangeToken(text.shortCode!), null);
    const fileRecord = await getExchange(file.token);
    assert.ok(fileRecord);
    const download = await openExchangeFile(fileRecord);
    assert.ok(download);
    const data = await new Response(download.stream).text();
    assert.equal(data, "driver fixture");
    assert.equal(await getShortExchangeToken(file.shortCode!), null);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test("one-time text and encrypted file exchanges are consumed and removed", async () => {
  const user = await prisma.user.create({ data: { name: "Exchange test" } });
  try {
    const quick = await createTextExchange(user.id, "short code proof", { ...once, quick: true });
    assert.match(quick.shortCode!, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{5}$/);
    assert.equal(await getShortExchangeToken(quick.shortCode!), quick.token);
    assert.equal((await listExchanges(user.id)).find((item) => item.token === quick.token)?.shortCode, quick.shortCode);
    const quickRecord = await getExchange(quick.token);
    assert.ok(quickRecord);
    assert.equal(await openExchangeText(quickRecord), "short code proof");
    assert.equal(await getShortExchangeToken(quick.shortCode!), null);

    const text = await createTextExchange(user.id, "hello from HomePlace", once);
    const textRecord = await getExchange(text.token);
    assert.ok(textRecord);
    assert.notEqual(textRecord.encryptedText, "hello from HomePlace");
    assert.equal(await openExchangeText(textRecord), "hello from HomePlace");
    assert.equal(await getExchange(text.token), null);
    assert.equal(await prisma.exchange.findUnique({ where: { id: textRecord.id } }), null);
    assert.equal((await listExchanges(user.id)).length, 0);

    const bytes = new TextEncoder().encode("file exchange proof");
    const shortFile = await createFileExchange(user.id, {
      filename: "quick.txt", mimeType: "text/plain", size: bytes.byteLength,
      stream: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
    }, { ...once, quick: true });
    assert.ok(shortFile.shortCode);
    assert.equal(await getShortExchangeToken(shortFile.shortCode), shortFile.token);
    const shortFileRecord = await getExchange(shortFile.token);
    assert.ok(shortFileRecord);
    const shortDownload = await openExchangeFile(shortFileRecord);
    assert.ok(shortDownload);
    const shortReader = shortDownload.stream.getReader();
    const shortParts: Uint8Array[] = [];
    for (;;) {
      const part = await shortReader.read();
      if (part.done) break;
      shortParts.push(part.value);
    }
    assert.equal(new TextDecoder().decode(Buffer.concat(shortParts)), "file exchange proof");
    assert.equal(await getShortExchangeToken(shortFile.shortCode), null);

    const file = await createFileExchange(user.id, {
      filename: "proof.txt",
      mimeType: "text/plain",
      size: bytes.byteLength,
      stream: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
    }, once);
    const fileRecord = await getExchange(file.token);
    assert.ok(fileRecord);
    const storedTransfer = await prisma.linkFileTransfer.findUnique({ where: { id: fileRecord.transferId! } });
    assert.ok(storedTransfer);
    assert.ok(storedTransfer.expiresAt.getTime() - Date.now() > 590_000);
    const download = await openExchangeFile(fileRecord);
    assert.ok(download);
    const chunks: Uint8Array[] = [];
    const reader = download.stream.getReader();
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      chunks.push(part.value);
    }
    assert.equal(new TextDecoder().decode(Buffer.concat(chunks)), "file exchange proof");
    assert.equal(await getExchange(file.token), null);
    assert.equal(await prisma.exchange.findUnique({ where: { id: fileRecord.id } }), null);
    assert.equal(await prisma.linkFileTransfer.findUnique({ where: { id: fileRecord.transferId! } }), null);

    const reusableFile = await createFileExchange(user.id, {
      filename: "again.txt",
      mimeType: "text/plain",
      size: bytes.byteLength,
      stream: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
    }, { ...once, deleteAfterOpen: false });
    for (let attempt = 0; attempt < 2; attempt++) {
      const record = await getExchange(reusableFile.token);
      assert.ok(record);
      const result = await openExchangeFile(record);
      assert.ok(result);
      const reader = result.stream.getReader();
      while (!(await reader.read()).done) { /* Consume and verify through the stream. */ }
    }
    assert.equal(await deleteExchange(user.id, reusableFile.token), true);
    assert.equal(await getExchange(reusableFile.token), null);

    const reusable = await createTextExchange(user.id, "delete me", { ...once, deleteAfterOpen: false });
    assert.equal(await deleteExchange(user.id, reusable.token), true);
    assert.equal(await getExchange(reusable.token), null);

    const largeSize = 5n * 1024n ** 3n;
    const metadata = await createTextExchange(user.id, "large metadata", { ...once, deleteAfterOpen: false });
    await prisma.exchange.update({ where: { tokenHash: (await getExchange(metadata.token))!.tokenHash }, data: { size: largeSize } });
    assert.equal((await getExchange(metadata.token))!.size, largeSize);
    assert.equal((await listExchanges(user.id)).find((item) => item.token === metadata.token)?.size, Number(largeSize));
    assert.equal(await deleteExchange(user.id, metadata.token), true);

    const transferMetadata = await prisma.linkFileTransfer.create({
      data: {
        sourceDeviceId: "test-source",
        targetDeviceId: "test-target",
        encryptedKey: "test-only",
        storageName: "test-large-metadata",
        filename: "large.bin",
        mimeType: "application/octet-stream",
        size: largeSize,
        sha256: "0".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    assert.equal(transferMetadata.size, largeSize);
    await prisma.linkFileTransfer.delete({ where: { id: transferMetadata.id } });
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
});
