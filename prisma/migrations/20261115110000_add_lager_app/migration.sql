-- Lager-app (/lager): brugere, hylder og idempotens-log.
-- Ingen beholdning her — BC er hovedbogen.
-- IF NOT EXISTS hele vejen: ensureLagerSchema() i src/lib/lager/db.ts opretter de samme
-- tabeller ved første kald, fordi migrationer ikke altid er kørt på serveren. De to må
-- kunne møde hinanden uden at vælte.

CREATE TABLE IF NOT EXISTS "LagerUser" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "initials" TEXT,
    "pinHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "defaultLocation" TEXT,
    "canCount" BOOLEAN NOT NULL DEFAULT true,
    "canPack" BOOLEAN NOT NULL DEFAULT false,
    "bcUserName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LagerUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LagerShelf" (
    "id" TEXT NOT NULL,
    "locationCode" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LagerShelf_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LagerShelf_locationCode_code_key" ON "LagerShelf"("locationCode", "code");
CREATE INDEX IF NOT EXISTS "LagerShelf_locationCode_sortOrder_idx" ON "LagerShelf"("locationCode", "sortOrder");

CREATE TABLE IF NOT EXISTS "LagerIdempotency" (
    "key" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "userId" TEXT,
    "result" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LagerIdempotency_pkey" PRIMARY KEY ("key")
);

CREATE INDEX IF NOT EXISTS "LagerIdempotency_createdAt_idx" ON "LagerIdempotency"("createdAt");
