-- CreateTable
CREATE TABLE "ScreenMoment" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "workMapId" UUID NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "offsetSeconds" INTEGER NOT NULL,
    "caption" TEXT NOT NULL,
    "image" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreenMoment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScreenMoment_workMapId_occurredAt_idx" ON "ScreenMoment"("workMapId", "occurredAt");

-- CreateIndex
CREATE INDEX "ScreenMoment_sessionId_occurredAt_idx" ON "ScreenMoment"("sessionId", "occurredAt");

-- AddForeignKey
ALTER TABLE "ScreenMoment" ADD CONSTRAINT "ScreenMoment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenMoment" ADD CONSTRAINT "ScreenMoment_workMapId_fkey" FOREIGN KEY ("workMapId") REFERENCES "WorkMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

