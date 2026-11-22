// Kanban — "tom hylde".
//
// Hylde-labelen (BC-rapport 50650) bærer en QR-kode, der peger på /k/<varenr>.
// Scanner nogen den, åbnes en side, hvor varen kan meldes tom. Meldingen står på
// kontorskærmen, indtil den er bestilt.
//
// QR'en er en ADRESSE og ikke en kode, kun vores app forstår. Det er praktisk, ikke
// teknisk: den der tømmer hylden er sjældent den, der går med håndterminalen. Med en
// adresse virker koden både i lager-appen og med et vilkårligt telefonkamera.
//
// GET SKRIVER IKKE. Scanningen åbner kun en side; meldingen kræver et tryk. Ellers
// kunne et tilfældigt scan — eller en linkforhåndsvisning — melde en hylde tom.

import { getItemsByNumbers } from '@/lib/businesscentral'
import { prisma } from '@/lib/prisma'

/**
 * Varenumre fra og med dette tal vises IKKE på salgsskærmen (Claus 22-11).
 *
 * Grænsen hører til VISNINGEN, ikke til printet: kanban-kortene bruges mest over
 * 90000 — emballage, rengøring, reservedele — men netop de varer er salgsafdelingen
 * uvedkommende. Deres meldinger er indkøberens.
 *
 * Signalet gemmes altid. Det er kun skærmen, der filtrerer.
 * (BC cu 50652 har en tilsvarende `SalgsskaermMaxItemNo()` liggende ubrugt. Når
 *  bestillingsappen kommer, skal den ene af dem væk — to tal er ét for mange.)
 */
export const SALGSSKAERM_MAX_VARENR = 90000

export interface KanbanRaekke {
  id:          string
  itemNo:      string
  description: string
  baseUom:     string
  bcInventory: number | null
  antal:       number
  firstAt:     string
  lastAt:      string
  meldtAf:     string
}

let ensured = false

/**
 * Opretter tabellen hvis den mangler. Samme mønster som lager-appen: migrationer
 * er ikke altid kørt på serveren, og en tom hylde skal kunne meldes alligevel.
 */
export async function ensureKanbanSchema() {
  if (ensured) return
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "KanbanSignal" (
      "id"          TEXT PRIMARY KEY,
      "itemNo"      TEXT NOT NULL,
      "description" TEXT NOT NULL DEFAULT '',
      "baseUom"     TEXT NOT NULL DEFAULT '',
      "bcInventory" DECIMAL(18,5),
      "status"      TEXT NOT NULL DEFAULT 'aaben',
      "antal"       INTEGER NOT NULL DEFAULT 1,
      "firstAt"     TIMESTAMP NOT NULL DEFAULT NOW(),
      "lastAt"      TIMESTAMP NOT NULL DEFAULT NOW(),
      "meldtAf"     TEXT NOT NULL DEFAULT '',
      "bestiltAt"   TIMESTAMP,
      "bestiltAf"   TEXT NOT NULL DEFAULT ''
    )
  `
  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS "KanbanSignal_status_lastAt_idx" ON "KanbanSignal"("status", "lastAt")
  `
  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS "KanbanSignal_itemNo_status_idx" ON "KanbanSignal"("itemNo", "status")
  `
  ensured = true
}

/** Varens navn, enhed og beholdning fra BC. null hvis varenummeret ikke findes. */
export async function hentVare(itemNo: string) {
  const varer = await getItemsByNumbers([itemNo])
  const vare = varer.find(v => v.number === itemNo)
  if (!vare) return null
  return {
    itemNo:      vare.number,
    description: vare.displayName,
    baseUom:     vare.baseUnitOfMeasureCode ?? '',
    inventory:   typeof vare.inventory === 'number' ? vare.inventory : null,
  }
}

/** Den åbne melding på varen, hvis der er en. */
export async function aabentSignal(itemNo: string) {
  await ensureKanbanSchema()
  return prisma.kanbanSignal.findFirst({
    where:   { itemNo, status: 'aaben' },
    orderBy: { lastAt: 'desc' },
  })
}

/**
 * Melder hylden tom.
 *
 * Er varen meldt i forvejen, bumpes tælleren i stedet for at lave en ny række —
 * ellers fyldte én tom hylde hele skærmen, og "de 5 nyeste" blev meningsløst.
 */
export async function meldTom(itemNo: string, meldtAf: string) {
  await ensureKanbanSchema()

  const findes = await aabentSignal(itemNo)
  if (findes) {
    return prisma.kanbanSignal.update({
      where: { id: findes.id },
      data:  {
        antal:   { increment: 1 },
        lastAt:  new Date(),
        // Den SENESTE melder står på skærmen — det er ham, man spørger.
        meldtAf: meldtAf || findes.meldtAf,
      },
    })
  }

  // Snapshot af varen, så skærmen kan vises uden et BC-kald pr. række. Svarer BC
  // ikke, melder vi alligevel: en tom hylde er en tom hylde, også når BC er nede.
  const vare = await hentVare(itemNo).catch(() => null)

  return prisma.kanbanSignal.create({
    data: {
      itemNo,
      description: vare?.description ?? '',
      baseUom:     vare?.baseUom ?? '',
      bcInventory: vare?.inventory ?? null,
      meldtAf,
    },
  })
}

/** Lukker meldingen. Uden den stod de samme fem varer på skærmen i ugevis. */
export async function markerBestilt(itemNo: string, af: string) {
  await ensureKanbanSchema()
  const res = await prisma.kanbanSignal.updateMany({
    where: { itemNo, status: 'aaben' },
    data:  { status: 'bestilt', bestiltAt: new Date(), bestiltAf: af },
  })
  return res.count
}

/**
 * De nyeste åbne meldinger til salgsskærmen.
 *
 * Varenumre over grænsen filtreres i JS og ikke i SQL, fordi varenummeret er en
 * tekst: '9000A' og '90000' kan ikke sammenlignes som tal i databasen. Der er
 * aldrig mange åbne meldinger, så det koster ingenting.
 */
export async function aabneSignaler(limit = 5): Promise<KanbanRaekke[]> {
  await ensureKanbanSchema()

  const raekker = await prisma.kanbanSignal.findMany({
    where:   { status: 'aaben' },
    orderBy: { lastAt: 'desc' },
    take:    limit * 4,  // plads til dem der filtreres væk
  })

  return raekker
    .filter(r => {
      const nr = Number(r.itemNo)
      return Number.isFinite(nr) && nr < SALGSSKAERM_MAX_VARENR
    })
    .slice(0, limit)
    .map(r => ({
      id:          r.id,
      itemNo:      r.itemNo,
      description: r.description,
      baseUom:     r.baseUom,
      bcInventory: r.bcInventory === null ? null : Number(r.bcInventory),
      antal:       r.antal,
      firstAt:     r.firstAt.toISOString(),
      lastAt:      r.lastAt.toISOString(),
      meldtAf:     r.meldtAf,
    }))
}
