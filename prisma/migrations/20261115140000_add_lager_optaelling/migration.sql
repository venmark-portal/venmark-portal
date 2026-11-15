-- Lageroptælling: tælling og rå linjer. BC får ÉN linje pr. vare når tællingen sendes.
-- IF NOT EXISTS: ensureOptaellingSchema() opretter de samme tabeller ved første kald.

CREATE TABLE IF NOT EXISTS "LagerCount" (
    "id" TEXT NOT NULL,
    "no" TEXT NOT NULL,
    "locationCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'aaben',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "note" TEXT,
    "bcLinesWritten" INTEGER,
    "bcDiffLines" INTEGER,
    "bcError" TEXT,

    CONSTRAINT "LagerCount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LagerCount_no_key" ON "LagerCount"("no");
CREATE INDEX IF NOT EXISTS "LagerCount_status_startedAt_idx" ON "LagerCount"("status", "startedAt");

CREATE TABLE IF NOT EXISTS "LagerCountLine" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "itemNo" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "qty" DECIMAL(18,5) NOT NULL,
    "uom" TEXT NOT NULL DEFAULT '',
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "shelfCode" TEXT,
    "lotNo" TEXT,
    "barcode" TEXT,
    "countedBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LagerCountLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LagerCountLine_countId_itemNo_idx" ON "LagerCountLine"("countId", "itemNo");

DO $$
BEGIN
  ALTER TABLE "LagerCountLine"
    ADD CONSTRAINT "LagerCountLine_countId_fkey"
    FOREIGN KEY ("countId") REFERENCES "LagerCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
