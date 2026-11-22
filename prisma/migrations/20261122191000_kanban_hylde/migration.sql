-- Hylden med på kanban-meldingen.
--
-- Hylden findes ikke i standard-API'ets varefelter, kun i vores eget
-- stregkodeopslag (BC side 50600), så den hentes med et selvstændigt kald når en
-- hylde meldes tom første gang. Den gemmes som snapshot ligesom navn og beholdning:
-- skærmen skal kunne vises uden et BC-kald pr. række.
--
-- Kolonnen tilføjes også af ensureKanbanSchema() i src/lib/kanban.ts, fordi
-- migrationer ikke altid er kørt på serveren.

ALTER TABLE "KanbanSignal" ADD COLUMN IF NOT EXISTS "shelfNo" TEXT NOT NULL DEFAULT '';
