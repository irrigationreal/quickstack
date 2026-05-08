-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "appIdsJson" TEXT,
    "projectIdsJson" TEXT,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_prefix_key" ON "ApiKey"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN "apiKeyId" TEXT;
ALTER TABLE "AuditEvent" ADD COLUMN "apiKeyName" TEXT;

-- CreateIndex
CREATE INDEX "AuditEvent_apiKeyId_idx" ON "AuditEvent"("apiKeyId");

-- AlterTable
ALTER TABLE "DeploymentRecord" ADD COLUMN "apiKeyId" TEXT;
ALTER TABLE "DeploymentRecord" ADD COLUMN "apiKeyName" TEXT;

-- CreateIndex
CREATE INDEX "DeploymentRecord_apiKeyId_idx" ON "DeploymentRecord"("apiKeyId");
