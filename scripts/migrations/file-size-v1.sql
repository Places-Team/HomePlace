-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Exchange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "access" TEXT NOT NULL DEFAULT 'link',
    "encryptedText" TEXT,
    "transferId" TEXT,
    "filename" TEXT,
    "mimeType" TEXT,
    "size" BIGINT,
    "deleteAfterOpen" BOOLEAN NOT NULL DEFAULT false,
    "openedAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Exchange_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Exchange" ("access", "createdAt", "deleteAfterOpen", "encryptedText", "encryptedToken", "expiresAt", "filename", "id", "kind", "mimeType", "openedAt", "ownerId", "size", "tokenHash", "transferId") SELECT "access", "createdAt", "deleteAfterOpen", "encryptedText", "encryptedToken", "expiresAt", "filename", "id", "kind", "mimeType", "openedAt", "ownerId", "size", "tokenHash", "transferId" FROM "Exchange";
DROP TABLE "Exchange";
ALTER TABLE "new_Exchange" RENAME TO "Exchange";
CREATE UNIQUE INDEX "Exchange_tokenHash_key" ON "Exchange"("tokenHash");
CREATE INDEX "Exchange_ownerId_createdAt_idx" ON "Exchange"("ownerId", "createdAt");
CREATE INDEX "Exchange_expiresAt_idx" ON "Exchange"("expiresAt");
CREATE TABLE "new_LinkFileTransfer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceDeviceId" TEXT NOT NULL,
    "targetDeviceId" TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "storageName" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_LinkFileTransfer" ("createdAt", "encryptedKey", "expiresAt", "filename", "id", "mimeType", "sha256", "size", "sourceDeviceId", "storageName", "targetDeviceId") SELECT "createdAt", "encryptedKey", "expiresAt", "filename", "id", "mimeType", "sha256", "size", "sourceDeviceId", "storageName", "targetDeviceId" FROM "LinkFileTransfer";
DROP TABLE "LinkFileTransfer";
ALTER TABLE "new_LinkFileTransfer" RENAME TO "LinkFileTransfer";
CREATE UNIQUE INDEX "LinkFileTransfer_storageName_key" ON "LinkFileTransfer"("storageName");
CREATE INDEX "LinkFileTransfer_targetDeviceId_expiresAt_idx" ON "LinkFileTransfer"("targetDeviceId", "expiresAt");
CREATE INDEX "LinkFileTransfer_expiresAt_idx" ON "LinkFileTransfer"("expiresAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
