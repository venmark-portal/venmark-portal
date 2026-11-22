-- Bestillingsforslaget skal se, hvad der ALLEREDE er i købsordre.
--
-- Uden det foreslår optællingen at bestille noget, der er på vej, og det er den
-- fejl, der giver dobbelt lager.
--
-- "paaOrdreSnart" er KUN det, der kommer inden horisonten, og det er det eneste,
-- der reelt dækker: en levering, der lander efter at varen kunne skaffes igen
-- alligevel, hjælper ikke den hylde, der er tom nu. Horisonten er varens egen
-- "kan skaffes igen"-dato når den har en leveringstid eller en bestillingsfrist,
-- ellers N dage frem (Venmark opsætning, standard 14 = samme horisont som
-- disponibel-beregningen).
--
-- Kolonnerne tilføjes også af ensureOptaellingSchema() i src/lib/lager/optaelling.ts,
-- fordi migrationer ikke altid er kørt på serveren.

ALTER TABLE "LagerCountLine" ADD COLUMN IF NOT EXISTS "paaOrdre" DECIMAL(18,5);
ALTER TABLE "LagerCountLine" ADD COLUMN IF NOT EXISTS "paaOrdreSnart" DECIMAL(18,5);
ALTER TABLE "LagerCountLine" ADD COLUMN IF NOT EXISTS "naesteModtagelse" TEXT;
ALTER TABLE "LagerCountLine" ADD COLUMN IF NOT EXISTS "horisontDage" INTEGER;
