-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "actorEmail" TEXT NOT NULL,
    "actorGroupName" TEXT,
    "actorType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "projectId" TEXT,
    "projectName" TEXT,
    "appId" TEXT,
    "appName" TEXT,
    "deploymentId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "message" TEXT,
    "metadataJson" TEXT,
    CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SecurityQuota" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL DEFAULT 'GLOBAL',
    "projectId" TEXT,
    "maxAppsPerProject" INTEGER,
    "maxReplicasPerApp" INTEGER,
    "maxMemoryLimitMbPerReplica" INTEGER,
    "maxCpuLimitMillicoresPerReplica" INTEGER,
    "maxTotalMemoryLimitMbPerProject" INTEGER,
    "maxTotalCpuLimitMillicoresPerProject" INTEGER,
    "maxDeploysPerUserPerHour" INTEGER,
    "maxDeploysPerAppPerHour" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DeploymentRecord" (
    "deploymentId" TEXT NOT NULL PRIMARY KEY,
    "appId" TEXT NOT NULL,
    "appName" TEXT,
    "projectId" TEXT NOT NULL,
    "projectName" TEXT,
    "actorUserId" TEXT,
    "actorEmail" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "forceBuild" BOOLEAN NOT NULL DEFAULT false,
    "sourceType" TEXT,
    "buildMethod" TEXT,
    "status" TEXT NOT NULL,
    "gitCommitHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeploymentRecord_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeployQuotaWindow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "windowStart" DATETIME NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");
CREATE INDEX "AuditEvent_actorEmail_idx" ON "AuditEvent"("actorEmail");
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");
CREATE INDEX "AuditEvent_outcome_idx" ON "AuditEvent"("outcome");
CREATE INDEX "AuditEvent_projectId_idx" ON "AuditEvent"("projectId");
CREATE INDEX "AuditEvent_appId_idx" ON "AuditEvent"("appId");
CREATE INDEX "AuditEvent_deploymentId_idx" ON "AuditEvent"("deploymentId");
CREATE UNIQUE INDEX "SecurityQuota_scope_projectId_key" ON "SecurityQuota"("scope", "projectId");
CREATE INDEX "DeploymentRecord_appId_idx" ON "DeploymentRecord"("appId");
CREATE INDEX "DeploymentRecord_projectId_idx" ON "DeploymentRecord"("projectId");
CREATE INDEX "DeploymentRecord_actorEmail_idx" ON "DeploymentRecord"("actorEmail");
CREATE INDEX "DeploymentRecord_createdAt_idx" ON "DeploymentRecord"("createdAt");
CREATE UNIQUE INDEX "DeployQuotaWindow_scopeType_scopeId_windowStart_key" ON "DeployQuotaWindow"("scopeType", "scopeId", "windowStart");

-- Append-only audit guards. Later SQLite table rebuild migrations must preserve these triggers.
CREATE TRIGGER "AuditEvent_no_update" BEFORE UPDATE ON "AuditEvent"
BEGIN
    SELECT RAISE(ABORT, 'AuditEvent is append-only');
END;

CREATE TRIGGER "AuditEvent_no_delete" BEFORE DELETE ON "AuditEvent"
BEGIN
    SELECT RAISE(ABORT, 'AuditEvent is append-only');
END;
