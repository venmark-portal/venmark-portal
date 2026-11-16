// Svar-robottens egne tabeller i portal-databasen. Oprettes selv første gang, ligesom
// PortalKurv — ingen migration at huske ved deploy.
//
//   "RobotKunde"  hvem der har robotten, og om den selv tager initiativet.
//                 Ingen række = robotten er slået fra for kunden.
//   "RobotBesked" hver tur i hver samtale. Det er både robottens hukommelse inden for
//                 en samtale (historikken sendes med til Claude) og kontorets log.

import { prisma } from '@/lib/prisma'

let ensured: Promise<void> | null = null

async function run(): Promise<void> {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "RobotKunde" (
      "customerId" TEXT PRIMARY KEY,
      aktiv        BOOLEAN NOT NULL DEFAULT true,
      initiativ    BOOLEAN NOT NULL DEFAULT false,
      "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT NOW()
    )
  `
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "RobotBesked" (
      id             BIGSERIAL PRIMARY KEY,
      "customerId"   TEXT NOT NULL,
      "samtaleId"    TEXT NOT NULL,
      rolle          TEXT NOT NULL,
      tekst          TEXT NOT NULL,
      vaerktoejer    TEXT NOT NULL DEFAULT '',
      "inputTokens"  INTEGER NOT NULL DEFAULT 0,
      "outputTokens" INTEGER NOT NULL DEFAULT 0,
      "cacheTokens"  INTEGER NOT NULL DEFAULT 0,
      "somAdmin"     TEXT,
      "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW()
    )
  `
  // Vurderinger: kunden 👍/👎 i chatten, kontoret 👍/👎 under /admin/robot. Både gode og
  // dårlige svar gennemgås — de dårlige retter robotten, de gode lærer kontoret noget om
  // hvad kunderne spørger om (og kan gemmes som viden, så robotten svarer ens næste gang).
  await prisma.$executeRaw`ALTER TABLE "RobotBesked" ADD COLUMN IF NOT EXISTS "kundeVurdering" SMALLINT`
  await prisma.$executeRaw`ALTER TABLE "RobotBesked" ADD COLUMN IF NOT EXISTS "kundeKommentar" TEXT`
  await prisma.$executeRaw`ALTER TABLE "RobotBesked" ADD COLUMN IF NOT EXISTS "kontorVurdering" SMALLINT`
  await prisma.$executeRaw`ALTER TABLE "RobotBesked" ADD COLUMN IF NOT EXISTS "kontorNote" TEXT`
  await prisma.$executeRaw`ALTER TABLE "RobotBesked" ADD COLUMN IF NOT EXISTS behandlet BOOLEAN NOT NULL DEFAULT false`
  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS "RobotBesked_samtale" ON "RobotBesked" ("samtaleId", id)
  `
  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS "RobotBesked_kunde_tid" ON "RobotBesked" ("customerId", "createdAt")
  `
}

export function ensureRobotSkema(): Promise<void> {
  if (!ensured) ensured = run().catch(err => { ensured = null; throw err })
  return ensured
}

export interface RobotStatus { aktiv: boolean; initiativ: boolean }

export async function hentRobotStatus(customerId: string): Promise<RobotStatus> {
  if (!customerId) return { aktiv: false, initiativ: false }
  await ensureRobotSkema()
  const rows = await prisma.$queryRaw<{ aktiv: boolean; initiativ: boolean }[]>`
    SELECT aktiv, initiativ FROM "RobotKunde" WHERE "customerId" = ${customerId}
  `
  return rows[0] ? { aktiv: rows[0].aktiv, initiativ: rows[0].initiativ } : { aktiv: false, initiativ: false }
}

/** Admin slår robotten til/fra. Initiativ bevares, når kun aktiv ændres. */
export async function saetRobotAktiv(customerId: string, aktiv: boolean): Promise<void> {
  await ensureRobotSkema()
  await prisma.$executeRaw`
    INSERT INTO "RobotKunde" ("customerId", aktiv, "updatedAt") VALUES (${customerId}, ${aktiv}, NOW())
    ON CONFLICT ("customerId") DO UPDATE SET aktiv = ${aktiv}, "updatedAt" = NOW()
  `
}

/** Kunden (eller admin) vælger, om robotten selv starter samtalen. */
export async function saetRobotInitiativ(customerId: string, initiativ: boolean): Promise<void> {
  await ensureRobotSkema()
  await prisma.$executeRaw`
    UPDATE "RobotKunde" SET initiativ = ${initiativ}, "updatedAt" = NOW() WHERE "customerId" = ${customerId}
  `
}

export interface RobotTur { rolle: 'kunde' | 'robot'; tekst: string }

/** Samtalens hidtidige tekst-ture, ældste først. Værktøjskald gentages ikke — robotten slår op igen.
 *
 *  Kun de seneste timer kommer med. En fane, der har stået åben til i dag, har samme samtaleId
 *  som i går, og uden grænsen kørte robotten videre i gårsdagens samtale, som om intet var sket
 *  (Claus 16-11) — med varer og ordrer, der ikke findes mere. Browseren starter også selv en ny
 *  samtale efter et ophold; dette er værnet, hvis den ikke gør.
 *
 *  Grænsen står som en SQL-literal (4 timer) og ikke som en parameter: make_interval/INTERVAL med
 *  en Prisma-parameter afhænger af, hvilken taltype driveren sender, og det er ikke værd at gætte på. */
export async function hentSamtale(customerId: string, samtaleId: string, max = 30): Promise<RobotTur[]> {
  await ensureRobotSkema()
  const rows = await prisma.$queryRaw<{ rolle: string; tekst: string }[]>`
    SELECT rolle, tekst FROM (
      SELECT id, rolle, tekst FROM "RobotBesked"
      WHERE "customerId" = ${customerId} AND "samtaleId" = ${samtaleId} AND rolle IN ('kunde', 'robot')
        AND "createdAt" > (NOW() AT TIME ZONE 'UTC') - INTERVAL '4 hours'
      ORDER BY id DESC LIMIT ${max}
    ) t ORDER BY id ASC
  `
  return rows.map(r => ({ rolle: r.rolle as 'kunde' | 'robot', tekst: r.tekst }))
}

export async function logTur(t: {
  customerId: string; samtaleId: string; rolle: 'kunde' | 'robot' | 'fejl'; tekst: string
  vaerktoejer?: string; inputTokens?: number; outputTokens?: number; cacheTokens?: number; somAdmin?: string | null
}): Promise<number> {
  await ensureRobotSkema()
  const rows = await prisma.$queryRaw<{ id: bigint }[]>`
    INSERT INTO "RobotBesked" ("customerId", "samtaleId", rolle, tekst, vaerktoejer, "inputTokens", "outputTokens", "cacheTokens", "somAdmin")
    VALUES (${t.customerId}, ${t.samtaleId}, ${t.rolle}, ${t.tekst}, ${t.vaerktoejer ?? ''},
            ${t.inputTokens ?? 0}, ${t.outputTokens ?? 0}, ${t.cacheTokens ?? 0}, ${t.somAdmin ?? null})
    RETURNING id
  `
  return Number(rows[0]?.id ?? 0)
}

/** Kundens 👍/👎 på et af robottens svar — kun på kundens egne svar. */
export async function saetKundeVurdering(customerId: string, id: number, vurdering: 1 | -1, kommentar: string | null): Promise<boolean> {
  await ensureRobotSkema()
  const n = await prisma.$executeRaw`
    UPDATE "RobotBesked" SET "kundeVurdering" = ${vurdering}, "kundeKommentar" = ${kommentar}, behandlet = false
    WHERE id = ${id} AND "customerId" = ${customerId} AND rolle = 'robot'
  `
  return n > 0
}

export async function saetKontorVurdering(id: number, vurdering: 1 | -1 | null, note: string | null): Promise<void> {
  await ensureRobotSkema()
  await prisma.$executeRaw`
    UPDATE "RobotBesked" SET "kontorVurdering" = ${vurdering}, "kontorNote" = ${note}, behandlet = true WHERE id = ${id}
  `
}

export async function markerBehandlet(id: number): Promise<void> {
  await ensureRobotSkema()
  await prisma.$executeRaw`UPDATE "RobotBesked" SET behandlet = true WHERE id = ${id}`
}

/** Kundens spørgsmål i dag (dansk tid) — til dagsloftet. */
export async function spoergsmaalIDag(customerId: string): Promise<number> {
  await ensureRobotSkema()
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM "RobotBesked"
    WHERE "customerId" = ${customerId} AND rolle = 'kunde'
      AND ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Copenhagen')::date
        = (NOW() AT TIME ZONE 'Europe/Copenhagen')::date
  `
  return Number(rows[0]?.n ?? 0)
}
