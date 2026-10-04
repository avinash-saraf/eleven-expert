-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('EXPERT', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('DRAFT', 'READY');

-- AlterTable
ALTER TABLE "WorkMap" ADD COLUMN     "createdById" UUID,
ADD COLUMN     "organizationId" UUID,
ADD COLUMN     "status" "WorkflowStatus" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "mediaStreamId" UUID,
ADD COLUMN     "userId" UUID;

-- CreateTable
CREATE TABLE "Organization" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoAccessToken" (
    "tokenHash" CHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoAccessToken_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_nameKey_key" ON "Organization"("nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "User_organizationId_nameKey_role_key" ON "User"("organizationId", "nameKey", "role");

-- CreateIndex
CREATE INDEX "DemoAccessToken_userId_idx" ON "DemoAccessToken"("userId");

-- CreateIndex
CREATE INDEX "DemoAccessToken_expiresAt_idx" ON "DemoAccessToken"("expiresAt");

-- CreateIndex
CREATE INDEX "WorkMap_organizationId_status_idx" ON "WorkMap"("organizationId", "status");

-- CreateIndex
CREATE INDEX "WorkMap_createdById_idx" ON "WorkMap"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "Session_mediaStreamId_key" ON "Session"("mediaStreamId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoAccessToken" ADD CONSTRAINT "DemoAccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkMap" ADD CONSTRAINT "WorkMap_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkMap" ADD CONSTRAINT "WorkMap_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
