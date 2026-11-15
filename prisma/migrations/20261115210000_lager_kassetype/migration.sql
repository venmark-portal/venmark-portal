-- Kassetype og produktion paa en optaellingslinje. Vaernet mod dobbelt vaegt:
-- pr. produktion scannes ENTEN samlekasser ELLER enkeltkasser, aldrig begge.
ALTER TABLE "LagerCountLine" ADD COLUMN IF NOT EXISTS "boxType" TEXT;
ALTER TABLE "LagerCountLine" ADD COLUMN IF NOT EXISTS "productionNo" TEXT;
