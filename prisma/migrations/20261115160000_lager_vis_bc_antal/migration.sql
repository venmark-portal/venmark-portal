-- Vis BC's antal under optælling. Blind tælling bliver et valg pr. optælling i
-- stedet for en regel: det meste stemmer, og så er det hurtigere at se forskellen
-- med det samme. bcQty gemmes på linjen, så oversigten kan vise forskellen uden
-- et nyt BC-kald pr. vare.

ALTER TABLE "LagerCount"     ADD COLUMN IF NOT EXISTS "blind" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LagerCountLine" ADD COLUMN IF NOT EXISTS "bcQty" DECIMAL(18,5);
