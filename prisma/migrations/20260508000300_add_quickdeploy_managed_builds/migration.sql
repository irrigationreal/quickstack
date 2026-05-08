-- AlterTable
ALTER TABLE "SecurityQuota" ADD COLUMN "maxQuickDeployUploadBytes" INTEGER;
ALTER TABLE "SecurityQuota" ADD COLUMN "maxQuickDeployUploadBytesPerHour" INTEGER;
ALTER TABLE "SecurityQuota" ADD COLUMN "maxQuickDeployBuildsPerUserPerHour" INTEGER;
ALTER TABLE "SecurityQuota" ADD COLUMN "maxConcurrentQuickDeployBuilds" INTEGER;

-- CreateTable
CREATE TABLE "QuickDeployBuild" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "imageReference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "uploadBytes" INTEGER NOT NULL,
    "createdByApiKeyId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QuickDeployBuild_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuickDeployBuild_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "QuickDeployBuild_appId_idx" ON "QuickDeployBuild"("appId");

-- CreateIndex
CREATE INDEX "QuickDeployBuild_projectId_idx" ON "QuickDeployBuild"("projectId");

-- CreateIndex
CREATE INDEX "QuickDeployBuild_contentHash_idx" ON "QuickDeployBuild"("contentHash");

-- CreateIndex
CREATE INDEX "QuickDeployBuild_createdAt_idx" ON "QuickDeployBuild"("createdAt");
