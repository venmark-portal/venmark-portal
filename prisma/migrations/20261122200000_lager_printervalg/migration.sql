-- Hvilken printer den enkelte portalbruger printer hylde-labels på.
--
-- Valget bor i portalen og ikke i BC: alle håndterminaler kalder BC ind som
-- OAuth-appen, så BC's eget "min printer" pr. bruger ville ramme appen og ikke
-- manden med terminalen. Printer-ID'et er BC's eget (virtuel tabel Printer),
-- så valget ikke kan komme ud af trit med PrintNode.
--
-- Tabellen oprettes også af ensurePrintSchema() i src/lib/lager/print.ts, fordi
-- migrationer ikke altid er kørt på serveren.

CREATE TABLE IF NOT EXISTS "LagerPrinterValg" (
  "brugerId"    TEXT PRIMARY KEY,
  "printerId"   TEXT NOT NULL,
  "printerNavn" TEXT NOT NULL DEFAULT '',
  "valgtAt"     TIMESTAMP NOT NULL DEFAULT NOW()
);
