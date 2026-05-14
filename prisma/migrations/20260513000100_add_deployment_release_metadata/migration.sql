ALTER TABLE "DeploymentRecord" ADD COLUMN "buildStrategy" TEXT;
ALTER TABLE "DeploymentRecord" ADD COLUMN "imageReference" TEXT;
ALTER TABLE "DeploymentRecord" ADD COLUMN "imageJson" TEXT;
ALTER TABLE "DeploymentRecord" ADD COLUMN "sourceProvenance" TEXT;
ALTER TABLE "DeploymentRecord" ADD COLUMN "buildId" TEXT;
ALTER TABLE "DeploymentRecord" ADD COLUMN "cacheHit" BOOLEAN;
