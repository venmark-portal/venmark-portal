-- Optælling og bestilling på samme tur ned langs hylderne.
--
-- Optællingen opretter ALDRIG en købsordre. Den fylder en bestillingskurv
-- ("BestillingOrdre"), og kurven sendes for sig af et menneske. To forskellige
-- dokumenter i BC må ikke hænge på én knap: en TryFunction ruller ikke
-- databaseskrivninger tilbage, så skrev lagerkladden og fejlede købsordren, stod
-- man med en halv afsendelse og ingen ren måde at gentage den.
--
-- Kolonnerne tilføjes også af ensureOptaellingSchema() i src/lib/lager/optaelling.ts,
-- fordi migrationer ikke altid er kørt på serveren. IF NOT EXISTS begge steder.

ALTER TABLE "LagerCount" ADD COLUMN IF NOT EXISTS "bestilling" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LagerCount" ADD COLUMN IF NOT EXISTS "bestillingId" TEXT;

-- Planlægningsfelterne pr. linje. NULL betyder "BC fortalte os ingenting" og er
-- IKKE det samme som tom/0: det første slår bestillingsforslaget fra, det andet
-- filtrerer varen væk som ikke-indkøbsvare.
ALTER TABLE "LagerCountLine" ADD COLUMN IF NOT EXISTS "vendorNo" TEXT;
ALTER TABLE "LagerCountLine" ADD COLUMN IF NOT EXISTS "reorderPoint" DECIMAL(18,5);
ALTER TABLE "LagerCountLine" ADD COLUMN IF NOT EXISTS "reorderQty" DECIMAL(18,5);
