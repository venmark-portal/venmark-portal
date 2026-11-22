// Bestillingsappen. Kurven bor her i portalen; BC får én linje pr. vare, når kurven
// sendes, og laver én ÅBEN købsordre pr. leverandør.
//
// To regler hele appen hviler på:
//   1. ÉN LINJE PR. VARE. Et scan af samme vare lægger ordrekvantum til på den linje
//      der allerede er der. Det er "en kasse mere", ikke en ny linje — ellers skulle
//      nogen lægge sammen bagefter.
//   2. SENDT ER SENDT. En kurv der har ramt BC kan ikke fyldes på. Var det muligt,
//      ville man stå med en kurv der peger på en købsordre, nogen måske har sendt til
//      leverandøren allerede (Claus 22-11).
//
// Der er INGEN priser i denne fil. Hverken kostpris eller indkøbspris.

import { prisma } from '@/lib/prisma'
import { ensureLagerSchema } from '@/lib/lager/db'
import { opslagTilBestilling, sendBestillingTilBC, type BestillingOpslag } from '@/lib/bestilling/bc'

let ensured = false

export async function ensureBestillingSchema() {
  if (ensured) return
  await ensureLagerSchema()
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "BestillingOrdre" (
      "id"            TEXT PRIMARY KEY,
      "no"            TEXT NOT NULL,
      "locationCode"  TEXT NOT NULL DEFAULT '',
      "status"        TEXT NOT NULL DEFAULT 'aaben',
      "startedAt"     TIMESTAMP NOT NULL DEFAULT NOW(),
      "closedAt"      TIMESTAMP,
      "createdById"   TEXT,
      "createdByName" TEXT NOT NULL DEFAULT '',
      "note"          TEXT,
      "bcOrderNos"    TEXT,
      "bcLines"       INTEGER,
      "bcFailed"      INTEGER,
      "bcError"       TEXT
    )
  `
  await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "BestillingOrdre_no_key" ON "BestillingOrdre"("no")`
  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS "BestillingOrdre_status_startedAt_idx" ON "BestillingOrdre"("status", "startedAt")
  `
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "BestillingLinje" (
      "id"          TEXT PRIMARY KEY,
      "ordreId"     TEXT NOT NULL,
      "itemNo"      TEXT NOT NULL,
      "description" TEXT NOT NULL DEFAULT '',
      "qty"         DECIMAL(18,5) NOT NULL,
      "uom"         TEXT NOT NULL DEFAULT '',
      "vendorNo"    TEXT NOT NULL DEFAULT '',
      "vendorName"  TEXT NOT NULL DEFAULT '',
      "reorderQty"  DECIMAL(18,5),
      "remark"      TEXT,
      "barcode"     TEXT,
      "scanCount"   INTEGER NOT NULL DEFAULT 1,
      "orderedBy"   TEXT NOT NULL DEFAULT '',
      "createdAt"   TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `
  await prisma.$executeRaw`
    CREATE UNIQUE INDEX IF NOT EXISTS "BestillingLinje_ordreId_itemNo_key" ON "BestillingLinje"("ordreId", "itemNo")
  `
  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS "BestillingLinje_ordreId_vendorNo_idx" ON "BestillingLinje"("ordreId", "vendorNo")
  `
  ensured = true
}

export interface Bestilling {
  id: string
  no: string
  locationCode: string
  status: string
  startedAt: Date
  createdByName: string
  note: string | null
  bcOrderNos: string | null
  bcLines: number | null
  bcFailed: number | null
  bcError: string | null
}

const FELTER = `id, "no", "locationCode", status, "startedAt", "createdByName", note,
                "bcOrderNos", "bcLines", "bcFailed", "bcError"`

/** BES-ÅÅMMDD-NN. Lokal dato — toISOString() ville give gårsdagens nummer om aftenen. */
async function nytNummer(): Promise<string> {
  const d = new Date()
  const dag =
    String(d.getFullYear()).slice(2) +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0')
  const praefiks = `BES-${dag}-`
  const rows = await prisma.$queryRaw<any[]>`
    SELECT "no" FROM "BestillingOrdre" WHERE "no" LIKE ${praefiks + '%'} ORDER BY "no" DESC LIMIT 1
  `
  const sidste = rows[0]?.no ? parseInt(String(rows[0].no).slice(-2), 10) : 0
  return praefiks + String(sidste + 1).padStart(2, '0')
}

export async function startBestilling(
  locationCode: string,
  brugerId: string,
  brugerNavn: string,
): Promise<Bestilling> {
  await ensureBestillingSchema()
  const id = `bes_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const no = await nytNummer()
  await prisma.$executeRaw`
    INSERT INTO "BestillingOrdre" ("id", "no", "locationCode", "createdById", "createdByName")
    VALUES (${id}, ${no}, ${locationCode}, ${brugerId}, ${brugerNavn})
  `
  return (await hentBestilling(id))!
}

export async function hentBestilling(id: string): Promise<Bestilling | null> {
  await ensureBestillingSchema()
  const rows = await prisma.$queryRawUnsafe<Bestilling[]>(
    `SELECT ${FELTER} FROM "BestillingOrdre" WHERE id = $1 LIMIT 1`,
    id,
  )
  return rows[0] ?? null
}

/**
 * De åbne kurve. ALLE brugeres, ikke kun ens egne: to mand i kølegangen skal kunne
 * fylde den samme kurv, og den ene skal kunne se at den anden er i gang — ellers
 * ender dagen med to halve bestillinger til samme leverandør.
 */
export async function aabneBestillinger(): Promise<Bestilling[]> {
  await ensureBestillingSchema()
  return prisma.$queryRawUnsafe<Bestilling[]>(
    `SELECT ${FELTER} FROM "BestillingOrdre" WHERE status = 'aaben' ORDER BY "startedAt" DESC LIMIT 20`,
  )
}

export async function sidsteSendte(antal = 10): Promise<Bestilling[]> {
  await ensureBestillingSchema()
  return prisma.$queryRawUnsafe<Bestilling[]>(
    `SELECT ${FELTER} FROM "BestillingOrdre" WHERE status = 'sendt' ORDER BY "closedAt" DESC LIMIT ${Math.min(antal, 50)}`,
  )
}

export interface BestillingLinje {
  id: string
  itemNo: string
  description: string
  qty: number
  uom: string
  vendorNo: string
  vendorName: string
  reorderQty: number | null
  remark: string
  barcode: string
  scanCount: number
  orderedBy: string
}

export async function hentLinjer(ordreId: string): Promise<BestillingLinje[]> {
  await ensureBestillingSchema()
  const rows = await prisma.$queryRaw<any[]>`
    SELECT id, "itemNo", description, qty, uom, "vendorNo", "vendorName", "reorderQty",
           COALESCE(remark,'') AS remark, COALESCE(barcode,'') AS barcode,
           "scanCount", "orderedBy"
    FROM "BestillingLinje"
    WHERE "ordreId" = ${ordreId}
    ORDER BY "vendorName", "itemNo"
  `
  return rows.map(r => ({
    id: r.id,
    itemNo: r.itemNo,
    description: r.description ?? '',
    qty: Number(r.qty ?? 0),
    uom: r.uom ?? '',
    vendorNo: r.vendorNo ?? '',
    vendorName: r.vendorName ?? '',
    reorderQty: r.reorderQty === null || r.reorderQty === undefined ? null : Number(r.reorderQty),
    remark: r.remark ?? '',
    barcode: r.barcode ?? '',
    scanCount: Number(r.scanCount ?? 0),
    orderedBy: r.orderedBy ?? '',
  }))
}

/**
 * Det antal appen foreslår, når en vare lægges i kurven.
 *
 * Ordrekvantum (varekortets felt 36) vinder, præcis som Claus bad om: "antal sæt
 * genbestillingsantal ind hvis det findes i BC". Ellers det stregkoden selv siger —
 * en kolli-kode betyder trods alt en kasse. Ellers 1.
 *
 * Tallet er ALTID i BASISENHEDEN, fordi ordrekvantum står i basisenheden. Blandede
 * enheder mellem forslag og linje er præcis dér et antal bliver ganget med en
 * omregningsfaktor, ingen havde bedt om.
 */
export function foreslaaetAntal(opslag: BestillingOpslag): number {
  if (opslag.reorderQuantity > 0) return opslag.reorderQuantity
  // En vægtkode bærer en faktisk vægt (7,4 kg). Den er en måling af det der stod på
  // hylden, ikke et ønske om at bestille 7,4 — så den skal ikke blive et antal.
  if (!opslag.variableWeight && opslag.quantity > 0) return opslag.quantity
  return 1
}

export interface LinjeSvar {
  itemNo: string
  description: string
  qty: number
  uom: string
  vendorNo: string
  vendorName: string
  /** true = varen var i kurven i forvejen, og antallet blev lagt til. */
  fandtes: boolean
  /** Hvad der blev lagt til denne gang. */
  tilfoejet: number
  scanCount: number
  foreslaaet: number
}

/**
 * Lægger en vare i kurven, eller lægger til på den linje der allerede er der.
 * `saet` SÆTTER antallet i stedet — det er sådan et tastet tal skal opføre sig:
 * scanner man en vare (24 stk.) og taster 10, skal der stå 10, ikke 34.
 */
export async function laegIKurv(
  ordreId: string,
  opslag: BestillingOpslag,
  brugerNavn: string,
  valg: { antal?: number; saet?: boolean; vendorNo?: string; vendorName?: string } = {},
): Promise<LinjeSvar> {
  await ensureBestillingSchema()
  const itemNo = opslag.itemNo.toUpperCase()
  const foreslaaet = foreslaaetAntal(opslag)
  const antal = valg.antal !== undefined && valg.antal !== null ? valg.antal : foreslaaet
  const vendorNo = valg.vendorNo ?? opslag.vendorNo
  const vendorName = valg.vendorName ?? opslag.vendorName
  const uom = opslag.baseUnitOfMeasure

  const findes = await prisma.$queryRaw<any[]>`
    SELECT id, qty, "scanCount" FROM "BestillingLinje"
    WHERE "ordreId" = ${ordreId} AND "itemNo" = ${itemNo} LIMIT 1
  `

  if (findes[0]) {
    const nuvaerende = Number(findes[0].qty ?? 0)
    const nyt = valg.saet ? antal : nuvaerende + antal
    await prisma.$executeRaw`
      UPDATE "BestillingLinje"
      SET qty = ${nyt}, "scanCount" = "scanCount" + 1,
          "vendorNo" = ${vendorNo}, "vendorName" = ${vendorName}
      WHERE id = ${findes[0].id}
    `
    return {
      itemNo, description: opslag.description, qty: nyt, uom, vendorNo, vendorName,
      fandtes: true, tilfoejet: nyt - nuvaerende,
      scanCount: Number(findes[0].scanCount ?? 0) + 1, foreslaaet,
    }
  }

  const id = `bl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  await prisma.$executeRaw`
    INSERT INTO "BestillingLinje"
      ("id","ordreId","itemNo","description","qty","uom","vendorNo","vendorName",
       "reorderQty","barcode","orderedBy")
    VALUES
      (${id}, ${ordreId}, ${itemNo}, ${opslag.description}, ${antal}, ${uom},
       ${vendorNo}, ${vendorName},
       ${opslag.reorderQuantity > 0 ? opslag.reorderQuantity : null},
       ${opslag.codeType === 'varenr' ? null : opslag.itemNo}, ${brugerNavn})
  `
  return {
    itemNo, description: opslag.description, qty: antal, uom, vendorNo, vendorName,
    fandtes: false, tilfoejet: antal, scanCount: 1, foreslaaet,
  }
}

export async function saetAntal(ordreId: string, itemNo: string, antal: number): Promise<boolean> {
  await ensureBestillingSchema()
  if (antal <= 0) return fjernLinje(ordreId, itemNo)
  const n = await prisma.$executeRaw`
    UPDATE "BestillingLinje" SET qty = ${antal}
    WHERE "ordreId" = ${ordreId} AND "itemNo" = ${itemNo.toUpperCase()}
  `
  return n > 0
}

export async function fjernLinje(ordreId: string, itemNo: string): Promise<boolean> {
  await ensureBestillingSchema()
  const n = await prisma.$executeRaw`
    DELETE FROM "BestillingLinje" WHERE "ordreId" = ${ordreId} AND "itemNo" = ${itemNo.toUpperCase()}
  `
  return n > 0
}

export async function saetBemaerkning(ordreId: string, itemNo: string, tekst: string): Promise<boolean> {
  await ensureBestillingSchema()
  const kort = tekst.slice(0, 150)
  const n = await prisma.$executeRaw`
    UPDATE "BestillingLinje" SET remark = ${kort || null}
    WHERE "ordreId" = ${ordreId} AND "itemNo" = ${itemNo.toUpperCase()}
  `
  return n > 0
}

export async function saetLeverandoer(
  ordreId: string,
  itemNo: string,
  vendorNo: string,
  vendorName: string,
): Promise<boolean> {
  await ensureBestillingSchema()
  const n = await prisma.$executeRaw`
    UPDATE "BestillingLinje" SET "vendorNo" = ${vendorNo}, "vendorName" = ${vendorName}
    WHERE "ordreId" = ${ordreId} AND "itemNo" = ${itemNo.toUpperCase()}
  `
  return n > 0
}

export async function saetOrdreBemaerkning(ordreId: string, tekst: string): Promise<boolean> {
  await ensureBestillingSchema()
  const n = await prisma.$executeRaw`
    UPDATE "BestillingOrdre" SET note = ${tekst.slice(0, 250) || null} WHERE id = ${ordreId}
  `
  return n > 0
}

/** Slår en vare op i BC og lægger den i kurven i ét. Returnerer null når BC ikke svarer. */
export async function scanTilKurv(
  ordreId: string,
  kode: string,
  locationCode: string,
  brugerNavn: string,
  valg: { antal?: number; saet?: boolean; vendorNo?: string; vendorName?: string } = {},
): Promise<{ opslag: BestillingOpslag; linje?: LinjeSvar } | null> {
  const opslag = await opslagTilBestilling(kode, locationCode)
  if (!opslag) return null
  if (!opslag.found) return { opslag }
  const linje = await laegIKurv(ordreId, opslag, brugerNavn, valg)
  return { opslag, linje }
}

export interface Leverandoergruppe {
  vendorNo: string
  vendorName: string
  linjer: BestillingLinje[]
}

/**
 * Kurven delt op pr. leverandør — det samme snit BC laver, så lagermanden kan se
 * hvor mange købsordrer det bliver, FØR han sender. Varer uden leverandør samles i
 * en gruppe for sig: de kan ikke bestilles, og det skal man kunne se på forhånd.
 */
export function grupperPrLeverandoer(linjer: BestillingLinje[]): Leverandoergruppe[] {
  const grupper = new Map<string, Leverandoergruppe>()
  for (const l of linjer) {
    const n = grupper.get(l.vendorNo) ?? {
      vendorNo: l.vendorNo,
      vendorName: l.vendorName || (l.vendorNo ? l.vendorNo : ''),
      linjer: [],
    }
    n.linjer.push(l)
    grupper.set(l.vendorNo, n)
  }
  // Varer uden leverandør sidst: de skal læses som en huskeliste, ikke som en ordre.
  return Array.from(grupper.values()).sort((a, b) => {
    if (!a.vendorNo) return 1
    if (!b.vendorNo) return -1
    return a.vendorName.localeCompare(b.vendorName, 'da')
  })
}

/**
 * Sender kurven til BC, som laver én åben købsordre pr. leverandør.
 * Der SENDES IKKE til leverandøren — et menneske godkender og sender i BC.
 */
export async function sendBestilling(
  ordreId: string,
): Promise<{ ok: boolean; ordrer?: number; ordreNumre?: string; linjer?: number; fejlede?: number; fejl?: string }> {
  const bestilling = await hentBestilling(ordreId)
  if (!bestilling) return { ok: false, fejl: 'Bestillingen findes ikke' }
  if (bestilling.status !== 'aaben') return { ok: false, fejl: `Bestillingen er allerede ${bestilling.status}` }

  const linjer = await hentLinjer(ordreId)
  if (linjer.length === 0) return { ok: false, fejl: 'Kurven er tom' }

  const svar = await sendBestillingTilBC(
    {
      no: bestilling.no,
      locationCode: bestilling.locationCode,
      orderedBy: bestilling.createdByName,
      note: bestilling.note ?? '',
    },
    linjer.map(l => ({
      itemNo: l.itemNo,
      qty: l.qty,
      uom: l.uom,
      vendorNo: l.vendorNo,
      remark: l.remark,
      barcode: l.barcode,
      scanCount: l.scanCount,
      reorderQty: l.reorderQty ?? 0,
    })),
  )

  if (!svar.ok) {
    await prisma.$executeRaw`
      UPDATE "BestillingOrdre" SET "bcError" = ${svar.fejl ?? 'Ukendt fejl'} WHERE id = ${ordreId}
    `
    return { ok: false, fejl: svar.fejl }
  }

  await prisma.$executeRaw`
    UPDATE "BestillingOrdre"
    SET status = 'sendt', "closedAt" = NOW(), "bcOrderNos" = ${svar.ordreNumre ?? ''},
        "bcLines" = ${svar.linjer ?? 0}, "bcFailed" = ${svar.fejlede ?? 0}, "bcError" = NULL
    WHERE id = ${ordreId}
  `

  return svar
}
