-- Kanban: "tom hylde". Nogen scanner QR-koden paa hylde-labelen, og varen staar
-- paa kontorskaermen, indtil den er bestilt.
--
-- IF NOT EXISTS hele vejen: ensureKanbanSchema() i src/lib/kanban.ts opretter den
-- samme tabel ved foerste kald, fordi migrationer ikke altid er koert paa serveren.
-- De to skal kunne moede hinanden uden at vaelte.

CREATE TABLE IF NOT EXISTS "KanbanSignal" (
    "id"          TEXT NOT NULL,
    "itemNo"      TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "baseUom"     TEXT NOT NULL DEFAULT '',
    "bcInventory" DECIMAL(18,5),
    "status"      TEXT NOT NULL DEFAULT 'aaben',
    "antal"       INTEGER NOT NULL DEFAULT 1,
    "firstAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meldtAf"     TEXT NOT NULL DEFAULT '',
    "bestiltAt"   TIMESTAMP(3),
    "bestiltAf"   TEXT NOT NULL DEFAULT '',

    CONSTRAINT "KanbanSignal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "KanbanSignal_status_lastAt_idx" ON "KanbanSignal"("status", "lastAt");
CREATE INDEX IF NOT EXISTS "KanbanSignal_itemNo_status_idx" ON "KanbanSignal"("itemNo", "status");
