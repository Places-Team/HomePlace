import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/db";
import {
  createFileExchange,
  createTextExchange,
  deleteExchange,
  getExchange,
  listExchanges,
  openExchangeFile,
  openExchangeText,
} from "../src/lib/exchange";
import type { ExchangeOptions } from "../src/lib/exchangePolicy";

if (!process.env.DATABASE_URL?.includes("homeplace-exchange-test")) {
  throw new Error("Run this integration test only against a disposable homeplace-exchange-test database");
}

const once: ExchangeOptions = { access: "link", deleteAfterOpen: true, expiresInSeconds: 600 };

test("one-time text and encrypted file exchanges are consumed and removed", async () => {
  const user = await prisma.user.create({ data: { name: "Exchange test" } });
  try {
    const text = await createTextExchange(user.id, "hello from HomePlace", once);
    const textRecord = await getExchange(text.token);
    assert.ok(textRecord);
    assert.notEqual(textRecord.encryptedText, "hello from HomePlace");
    assert.equal(await openExchangeText(textRecord), "hello from HomePlace");
    assert.equal(await getExchange(text.token), null);
    assert.equal(await prisma.exchange.findUnique({ where: { id: textRecord.id } }), null);
    assert.equal((await listExchanges(user.id)).length, 0);

    const bytes = new TextEncoder().encode("file exchange proof");
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
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
});
