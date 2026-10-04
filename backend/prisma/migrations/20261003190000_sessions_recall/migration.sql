-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SessionMode" AS ENUM ('LEARN', 'TEACH');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('CREATING', 'JOINING', 'WAITING_ROOM', 'IN_CALL', 'RECORDING', 'STOPPING', 'ENDED', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "WorkMap" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "definition" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "meetingUrl" TEXT NOT NULL,
    "mode" "SessionMode" NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'CREATING',
    "requestKey" TEXT,
    "requestFingerprint" TEXT,
    "recallBotId" TEXT,
    "recallStatus" TEXT,
    "lastRecallEventAt" TIMESTAMP(3),
    "stopRequestedAt" TIMESTAMP(3),
    "error" TEXT,
    "workMapId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionEvent" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecallWebhookDelivery" (
    "id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,

    CONSTRAINT "RecallWebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_requestKey_key" ON "Session"("requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "Session_recallBotId_key" ON "Session"("recallBotId");

-- CreateIndex
CREATE INDEX "Session_workMapId_idx" ON "Session"("workMapId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionEvent_deliveryId_key" ON "SessionEvent"("deliveryId");

-- CreateIndex
CREATE INDEX "SessionEvent_sessionId_occurredAt_idx" ON "SessionEvent"("sessionId", "occurredAt");

-- CreateIndex
CREATE INDEX "RecallWebhookDelivery_processedAt_nextAttemptAt_idx" ON "RecallWebhookDelivery"("processedAt", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_workMapId_fkey" FOREIGN KEY ("workMapId") REFERENCES "WorkMap"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionEvent" ADD CONSTRAINT "SessionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
