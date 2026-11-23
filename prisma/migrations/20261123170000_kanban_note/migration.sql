-- Besked fra den der melder hylden tom — skrevet eller indtalt paa haandterminalen.
-- Samme mønster som resten af lager-tabellerne: ensureKanbanSchema() i
-- src/lib/kanban.ts tilføjer kolonnen ogsaa, hvis migrationen ikke er kørt paa serveren.
ALTER TABLE "KanbanSignal" ADD COLUMN IF NOT EXISTS "note" TEXT NOT NULL DEFAULT '';
