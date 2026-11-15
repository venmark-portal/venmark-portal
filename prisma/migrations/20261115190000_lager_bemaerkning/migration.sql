-- Bemaerkning paa en optaellingslinje. Foelger med til kladdelinjen i BC sammen
-- med ANSLAAET-maerket, saa kontoret kan laese hvorfor et tal ser ud som det goer.
ALTER TABLE "LagerCountLine" ADD COLUMN IF NOT EXISTS "remark" TEXT;
