// Gemt kurv på bestillingssiden.
//
// KUN varenummer, antal og enhed gemmes — ALDRIG prisen.
//
// Kurven indeholder på skærmen en hel varepost med pris. Gemte man den som den
// er og lagde den tilbage dagen efter, ville kunden se gårsdagens pris på
// auktionsfisk og opdage det først på fakturaen. Derfor slås varerne op forfra
// når siden indlæses, med dagens priser, dagens disponibel og dagens lofter —
// og en vare der i mellemtiden er udsolgt bliver skåret ned af den clamp der i
// forvejen kører ved datoskift.
//
// Gemmes på SERVEREN og ikke i browseren, så kurven følger kunden fra PC til
// telefon. Nøglen er kunden, ikke brugeren: to personer hos samme kunde deler
// bestillingen, ligesom de deler ordrerne.

import { prisma } from '@/lib/prisma'

export interface KurvLinje {
  itemNo:   string
  quantity: number
  uom:      string
}

export interface GemtKurv {
  linjer:   KurvLinje[]
  /** Hvornår kurven sidst blev rørt. Null når der ikke er nogen. */
  gemtAt:   string | null
}

let ensured: Promise<void> | null = null

async function run(): Promise<void> {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "PortalKurv" (
      "customerId" TEXT NOT NULL,
      "itemNo"     TEXT NOT NULL,
      quantity     DOUBLE PRECISION NOT NULL,
      uom          TEXT NOT NULL DEFAULT '',
      "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT NOW(),
      PRIMARY KEY ("customerId", "itemNo")
    )
  `
}

export function ensureKurvSkema(): Promise<void> {
  if (!ensured) {
    ensured = run().catch(err => { ensured = null; throw err })
  }
  return ensured
}

export async function hentKurv(customerId: string): Promise<GemtKurv> {
  if (!customerId) return { linjer: [], gemtAt: null }
  await ensureKurvSkema()

  const rows = await prisma.$queryRaw<{
    itemNo: string; quantity: number; uom: string; updatedAt: Date
  }[]>`
    SELECT "itemNo", quantity, uom, "updatedAt"
    FROM "PortalKurv" WHERE "customerId" = ${customerId}
  `
  if (rows.length === 0) return { linjer: [], gemtAt: null }

  const nyeste = rows.reduce((a, r) => (r.updatedAt > a ? r.updatedAt : a), rows[0].updatedAt)
  return {
    linjer: rows.map(r => ({ itemNo: r.itemNo, quantity: r.quantity, uom: r.uom })),
    gemtAt: nyeste.toISOString(),
  }
}

/**
 * Skriver kurven forfra. Tomt array rydder den — det er sådan "kurven er tom"
 * ser ud, og uden det ville en ryddet kurv dukke op igen ved næste besøg.
 */
export async function gemKurv(customerId: string, linjer: KurvLinje[]): Promise<void> {
  if (!customerId) return
  await ensureKurvSkema()

  const rene = linjer
    .filter(l => l.itemNo && Number.isFinite(l.quantity) && l.quantity > 0)
    .slice(0, 500)   // en kurv med 500 linjer er en fejl, ikke en bestilling

  await prisma.$transaction([
    prisma.$executeRaw`DELETE FROM "PortalKurv" WHERE "customerId" = ${customerId}`,
    ...rene.map(l => prisma.$executeRaw`
      INSERT INTO "PortalKurv" ("customerId", "itemNo", quantity, uom, "updatedAt")
      VALUES (${customerId}, ${l.itemNo}, ${l.quantity}, ${l.uom ?? ''}, NOW())
    `),
  ])
}

/** Rydder kurven — kaldes når ordren er sendt. */
export async function rydKurv(customerId: string): Promise<void> {
  if (!customerId) return
  await ensureKurvSkema()
  await prisma.$executeRaw`DELETE FROM "PortalKurv" WHERE "customerId" = ${customerId}`
}
