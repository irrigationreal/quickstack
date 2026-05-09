-- CreateTable
CREATE TABLE "PublicAddressPool" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "addressesJson" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'PUBLIC_ENDPOINTS',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PublicAddressPool_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublicEndpointReservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publicIp" TEXT NOT NULL,
    "publicPort" INTEGER NOT NULL,
    "protocol" TEXT NOT NULL DEFAULT 'TCP',
    "ownerType" TEXT NOT NULL DEFAULT 'SYSTEM',
    "ownerId" TEXT,
    "name" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AppPublicEndpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appId" TEXT NOT NULL,
    "name" TEXT,
    "publicIp" TEXT NOT NULL,
    "publicPort" INTEGER NOT NULL,
    "targetPort" INTEGER NOT NULL,
    "protocol" TEXT NOT NULL DEFAULT 'TCP',
    "sourceCidrsJson" TEXT,
    "proxyProtocol" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AppPublicEndpoint_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicAddressPool_projectId_name_key" ON "PublicAddressPool"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PublicEndpointReservation_publicIp_publicPort_protocol_key" ON "PublicEndpointReservation"("publicIp", "publicPort", "protocol");

-- CreateIndex
CREATE UNIQUE INDEX "AppPublicEndpoint_publicIp_publicPort_protocol_key" ON "AppPublicEndpoint"("publicIp", "publicPort", "protocol");

-- CreateIndex
CREATE INDEX "AppPublicEndpoint_appId_idx" ON "AppPublicEndpoint"("appId");
