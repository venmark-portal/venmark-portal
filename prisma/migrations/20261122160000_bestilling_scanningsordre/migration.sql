-- Bestillingsapp: scanningsordrer. IF NOT EXISTS hele vejen, fordi
-- ensureBestillingSchema() ogsaa opretter dem paa en server hvor
-- migrationerne ikke er koert.
CREATE TABLE IF NOT EXISTS "BestillingOrdre" (
  "id"            TEXT PRIMARY KEY,
  "no"            TEXT NOT NULL,
  "locationCode"  TEXT NOT NULL DEFAULT '',
  "status"        TEXT NOT NULL DEFAULT 'aaben',
  "startedAt"     TIMESTAMP NOT NULL DEFAULT NOW(),
  "closedAt"      TIMESTAMP,
  "createdById"   TEXT,
  "createdByName" TEXT NOT NULL DEFAULT '',
  "note"          TEXT,
  "bcOrderNos"    TEXT,
  "bcLines"       INTEGER,
  "bcFailed"      INTEGER,
  "bcError"       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "BestillingOrdre_no_key" ON "BestillingOrdre"("no");
CREATE INDEX IF NOT EXISTS "BestillingOrdre_status_startedAt_idx" ON "BestillingOrdre"("status", "startedAt");

CREATE TABLE IF NOT EXISTS "BestillingLinje" (
  "id"          TEXT PRIMARY KEY,
  "ordreId"     TEXT NOT NULL,
  "itemNo"      TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "qty"         DECIMAL(18,5) NOT NULL,
  "uom"         TEXT NOT NULL DEFAULT '',
  "vendorNo"    TEXT NOT NULL DEFAULT '',
  "vendorName"  TEXT NOT NULL DEFAULT '',
  "reorderQty"  DECIMAL(18,5),
  "remark"      TEXT,
  "barcode"     TEXT,
  "scanCount"   INTEGER NOT NULL DEFAULT 1,
  "orderedBy"   TEXT NOT NULL DEFAULT '',
  "createdAt"   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "BestillingLinje_ordreId_itemNo_key" ON "BestillingLinje"("ordreId", "itemNo");
CREATE INDEX IF NOT EXISTS "BestillingLinje_ordreId_vendorNo_idx" ON "BestillingLinje"("ordreId", "vendorNo");
