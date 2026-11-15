import { prisma } from '@/lib/prisma'

// ─── Portal-aktivitet: hvor meget kunderne bruger portalen ───────────────────
//
// Én række pr. (dag × login-bruger × valgt butik). Klienten (AktivitetsMaaler) sender
// en sidevisning ved hvert sideskift og en "puls" hvert minut mens fanen er synlig OG
// brugeren har rørt mus/tastatur/skærm inden for de sidste 2 minutter. Hver puls = 60 s
// aktiv tid; serveren tæller højst én puls pr. 45 s pr. række, så flere åbne faner ikke
// tæller dobbelt.
//
// Ren server-side log af indloggede brugere — ingen cookies/localStorage ud over login-
// sessionen, så det kræver ikke cookie-samtykke. Admin "som kunde" logges IKKE.
//
// Tabellen oprettes selv ved første brug (deploy kører ikke prisma migrate).

let tabelKlar: Promise<void> | null = null

export function sikrAktivitetsTabel(): Promise<void> {
  if (!tabelKlar) {
    tabelKlar = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "PortalAktivitet" (
          "id"             TEXT PRIMARY KEY,
          "dag"            DATE NOT NULL,
          "kundeNr"        TEXT NOT NULL,
          "kundeNavn"      TEXT,
          "brugerEmail"    TEXT NOT NULL,
          "brugerNavn"     TEXT,
          "erKontakt"      BOOLEAN NOT NULL DEFAULT false,
          "enhed"          TEXT,
          "foersteBesoeg"  TIMESTAMPTZ NOT NULL DEFAULT now(),
          "sidsteBesoeg"   TIMESTAMPTZ NOT NULL DEFAULT now(),
          "sidstePuls"     TIMESTAMPTZ,
          "aktiveSekunder" INTEGER NOT NULL DEFAULT 0,
          "sidevisninger"  INTEGER NOT NULL DEFAULT 0,
          "sider"          JSONB NOT NULL DEFAULT '{}'::jsonb
        )`)
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PortalAktivitet_dag_idx" ON "PortalAktivitet" ("dag")`)
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PortalAktivitet_kundeNr_idx" ON "PortalAktivitet" ("kundeNr")`)
    })().catch(e => { tabelKlar = null; throw e })
  }
  return tabelKlar
}

/** Dagens dato i dansk tid (serveren kører UTC). */
export function danskDag(d = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen' }).format(d)
}

/** /portal/ordrer/W0001234 → /portal/ordrer/:id — så siderne kan tælles sammen. */
export function normaliserSti(sti: string): string | null {
  const ren = sti.split(/[?#]/)[0]
  if (!ren.startsWith('/portal')) return null
  const dele = ren.split('/').filter(Boolean).slice(0, 4)
    .map(s => (/\d/.test(s) || s.length > 30 ? ':id' : s))
  return ('/' + dele.join('/')).slice(0, 80)
}

export interface AktivitetsHaendelse {
  type:        'side' | 'puls'
  sti:         string | null
  kundeNr:     string
  kundeNavn:   string
  brugerEmail: string
  brugerNavn:  string
  erKontakt:   boolean
  enhed:       'mobil' | 'desktop'
}

export async function registrerAktivitet(h: AktivitetsHaendelse): Promise<void> {
  await sikrAktivitetsTabel()
  const dag   = danskDag()
  const id    = `${dag}|${h.brugerEmail}|${h.kundeNr}`
  const side  = h.type === 'side' && h.sti ? h.sti : null
  const puls  = h.type === 'puls'

  await prisma.$executeRaw`
    INSERT INTO "PortalAktivitet"
      ("id", "dag", "kundeNr", "kundeNavn", "brugerEmail", "brugerNavn", "erKontakt", "enhed",
       "sidstePuls", "aktiveSekunder", "sidevisninger", "sider")
    VALUES
      (${id}, ${dag}::date, ${h.kundeNr}, ${h.kundeNavn}, ${h.brugerEmail}, ${h.brugerNavn}, ${h.erKontakt}, ${h.enhed},
       ${puls ? new Date() : null}, ${puls ? 60 : 0}, ${side ? 1 : 0},
       CASE WHEN ${side}::text IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(${side}::text, 1) END)
    ON CONFLICT ("id") DO UPDATE SET
      "sidsteBesoeg"   = now(),
      "kundeNavn"      = EXCLUDED."kundeNavn",
      "brugerNavn"     = EXCLUDED."brugerNavn",
      "enhed"          = EXCLUDED."enhed",
      "aktiveSekunder" = "PortalAktivitet"."aktiveSekunder" + CASE
                           WHEN ${puls} AND ("PortalAktivitet"."sidstePuls" IS NULL
                                 OR now() - "PortalAktivitet"."sidstePuls" >= interval '45 seconds')
                           THEN 60 ELSE 0 END,
      "sidstePuls"     = CASE
                           WHEN ${puls} AND ("PortalAktivitet"."sidstePuls" IS NULL
                                 OR now() - "PortalAktivitet"."sidstePuls" >= interval '45 seconds')
                           THEN now() ELSE "PortalAktivitet"."sidstePuls" END,
      "sidevisninger"  = "PortalAktivitet"."sidevisninger" + ${side ? 1 : 0},
      "sider"          = CASE WHEN ${side}::text IS NULL THEN "PortalAktivitet"."sider"
                           ELSE jsonb_set("PortalAktivitet"."sider", ARRAY[${side}::text],
                                  to_jsonb(COALESCE(("PortalAktivitet"."sider" ->> ${side}::text)::int, 0) + 1))
                         END
  `
}
