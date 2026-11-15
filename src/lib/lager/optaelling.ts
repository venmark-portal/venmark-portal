// Lageroptælling. Tælleprocessen bor her i portalen; BC får ÉN linje pr. vare når
// tællingen sendes — summen af hylderne.
//
// Blind tælling er hele pointen: ingen af funktionerne her giver BC's tal tilbage til
// terminalen. Når en vare afsluttes, svarer serveren KUN om det stemmer. Tallene ser
// kontoret, på optællingen i BC.

import { prisma } from '@/lib/prisma'
import { ensureLagerSchema } from '@/lib/lager/db'
import { resolveBarcode, sendCountToBC } from '@/lib/lager/bc'

let ensured = false

export async function ensureOptaellingSchema() {
  if (ensured) return
  await ensureLagerSchema()
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "LagerCount" (
      "id"             TEXT PRIMARY KEY,
      "no"             TEXT NOT NULL,
      "locationCode"   TEXT NOT NULL,
      "status"         TEXT NOT NULL DEFAULT 'aaben',
      "startedAt"      TIMESTAMP NOT NULL DEFAULT NOW(),
      "closedAt"       TIMESTAMP,
      "createdById"    TEXT,
      "createdByName"  TEXT NOT NULL DEFAULT '',
      "note"           TEXT,
      "bcLinesWritten" INTEGER,
      "bcDiffLines"    INTEGER,
      "bcError"        TEXT
    )
  `
  await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "LagerCount_no_key" ON "LagerCount"("no")`
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "LagerCountLine" (
      "id"          TEXT PRIMARY KEY,
      "countId"     TEXT NOT NULL,
      "itemNo"      TEXT NOT NULL,
      "description" TEXT NOT NULL DEFAULT '',
      "qty"         DECIMAL(18,5) NOT NULL,
      "uom"         TEXT NOT NULL DEFAULT '',
      "estimated"   BOOLEAN NOT NULL DEFAULT false,
      "confirmed"   BOOLEAN NOT NULL DEFAULT false,
      "shelfCode"   TEXT,
      "lotNo"       TEXT,
      "barcode"     TEXT,
      "countedBy"   TEXT NOT NULL DEFAULT '',
      "createdAt"   TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `
  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS "LagerCountLine_countId_itemNo_idx" ON "LagerCountLine"("countId", "itemNo")
  `
  // Tilføjet 15-11: BC's antal vises som standard. Blind tælling er stadig muligt,
  // men er nu et valg pr. optælling — det meste stemmer, og så er det hurtigere at
  // se forskellen med det samme.
  await prisma.$executeRaw`ALTER TABLE "LagerCount" ADD COLUMN IF NOT EXISTS "blind" BOOLEAN NOT NULL DEFAULT false`
  await prisma.$executeRaw`ALTER TABLE "LagerCountLine" ADD COLUMN IF NOT EXISTS "bcQty" DECIMAL(18,5)`
  ensured = true
}

export interface Optaelling {
  id: string
  no: string
  locationCode: string
  status: string
  startedAt: Date
  createdByName: string
  note: string | null
  /** true = tælleren ser ikke BC's tal. Standard er false: det meste stemmer. */
  blind: boolean
  bcLinesWritten: number | null
  bcDiffLines: number | null
  bcError: string | null
}

const FELTER = `id, "no", "locationCode", status, "startedAt", "createdByName", note, blind,
                "bcLinesWritten", "bcDiffLines", "bcError"`

/** OPT-ÅÅMMDD-NN. Lokal dato — toISOString() ville give gårsdagens nummer om aftenen. */
async function nytNummer(): Promise<string> {
  const d = new Date()
  const dag =
    String(d.getFullYear()).slice(2) +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0')
  const præfiks = `OPT-${dag}-`
  const rows = await prisma.$queryRaw<any[]>`
    SELECT "no" FROM "LagerCount" WHERE "no" LIKE ${præfiks + '%'} ORDER BY "no" DESC LIMIT 1
  `
  const sidste = rows[0]?.no ? parseInt(String(rows[0].no).slice(-2), 10) : 0
  return præfiks + String(sidste + 1).padStart(2, '0')
}

export async function startOptaelling(
  locationCode: string,
  brugerId: string,
  brugerNavn: string,
  blind = false,
): Promise<Optaelling> {
  await ensureOptaellingSchema()
  const id = `cnt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const no = await nytNummer()
  await prisma.$executeRaw`
    INSERT INTO "LagerCount" ("id", "no", "locationCode", "createdById", "createdByName", blind)
    VALUES (${id}, ${no}, ${locationCode}, ${brugerId}, ${brugerNavn}, ${blind})
  `
  return (await hentOptaelling(id))!
}

export async function hentOptaelling(id: string): Promise<Optaelling | null> {
  await ensureOptaellingSchema()
  const rows = await prisma.$queryRawUnsafe<Optaelling[]>(
    `SELECT ${FELTER} FROM "LagerCount" WHERE id = $1 LIMIT 1`,
    id,
  )
  return rows[0] ?? null
}

export async function aabneOptaellinger(): Promise<Optaelling[]> {
  await ensureOptaellingSchema()
  return prisma.$queryRawUnsafe<Optaelling[]>(
    `SELECT ${FELTER} FROM "LagerCount" WHERE status = 'aaben' ORDER BY "startedAt" DESC LIMIT 20`,
  )
}

export interface NyLinje {
  itemNo: string
  description?: string
  qty: number
  uom?: string
  estimated?: boolean
  confirmed?: boolean
  shelfCode?: string
  lotNo?: string
  barcode?: string
  /** BC-beholdningen som opslaget gav. Gemmes, så oversigten kan vise forskellen
   *  uden et nyt BC-kald pr. vare. */
  bcQty?: number | null
}

/**
 * Gemmer én registrering. Returnerer varens løbende total PÅ DENNE TÆLLING — ikke
 * BC's tal. Terminalen skal kunne se hvad den selv har talt, og intet andet.
 */
export async function tilfoejLinje(
  countId: string,
  linje: NyLinje,
  brugerNavn: string,
): Promise<{ total: number; antal: number }> {
  await ensureOptaellingSchema()
  const id = `cl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  await prisma.$executeRaw`
    INSERT INTO "LagerCountLine"
      ("id","countId","itemNo","description","qty","uom","estimated","confirmed","shelfCode","lotNo","barcode","countedBy","bcQty")
    VALUES
      (${id}, ${countId}, ${linje.itemNo.toUpperCase()}, ${linje.description ?? ''}, ${linje.qty},
       ${linje.uom ?? ''}, ${!!linje.estimated}, ${!!linje.confirmed},
       ${linje.shelfCode ?? null}, ${linje.lotNo ?? null}, ${linje.barcode ?? null}, ${brugerNavn},
       ${linje.bcQty ?? null})
  `
  return vareTotal(countId, linje.itemNo)
}

/**
 * Er denne FYSISKE kasse allerede talt på tællingen? En kasse- eller lot-stregkode
 * sidder på én bestemt kasse, så det samme scan to gange er en fejl, ikke to kasser.
 * Det er også værnet mod dobbelt vægt når både en samlekasse og dens indhold står på
 * hylden — se fælden om subtotal-kasser.
 */
export async function kasseAlleredeTalt(countId: string, barcode: string): Promise<boolean> {
  if (!barcode) return false
  const rows = await prisma.$queryRaw<any[]>`
    SELECT 1 FROM "LagerCountLine"
    WHERE "countId" = ${countId} AND UPPER(COALESCE(barcode,'')) = ${barcode.toUpperCase()} LIMIT 1
  `
  return rows.length > 0
}

export async function vareTotal(
  countId: string,
  itemNo: string,
): Promise<{ total: number; antal: number; bcAntal: number | null }> {
  const rows = await prisma.$queryRaw<any[]>`
    SELECT COALESCE(SUM(qty), 0) AS total, COUNT(*) AS antal, MAX("bcQty") AS bcqty
    FROM "LagerCountLine" WHERE "countId" = ${countId} AND "itemNo" = ${itemNo.toUpperCase()}
  `
  return {
    total: Number(rows[0]?.total ?? 0),
    antal: Number(rows[0]?.antal ?? 0),
    bcAntal: rows[0]?.bcqty === null || rows[0]?.bcqty === undefined ? null : Number(rows[0].bcqty),
  }
}

/** Fjerner den seneste registrering på en vare — fortryd-knappen. */
export async function fortrydSidste(countId: string, itemNo: string): Promise<boolean> {
  await ensureOptaellingSchema()
  const n = await prisma.$executeRaw`
    DELETE FROM "LagerCountLine" WHERE id = (
      SELECT id FROM "LagerCountLine"
      WHERE "countId" = ${countId} AND "itemNo" = ${itemNo.toUpperCase()}
      ORDER BY "createdAt" DESC LIMIT 1
    )
  `
  return n > 0
}

/**
 * Tjekker en færdigtalt vare mod BC. Svaret er BEVIDST fattigt: stemmer eller ikke.
 * Tælleren må ikke få tallet — så var tællingen ikke blind, og så tæller folk efter
 * hukommelsen i stedet for efter hylden.
 */
export async function tjekVare(
  countId: string,
  itemNo: string,
  locationCode: string,
  blind = false,
): Promise<{ stemmer: boolean; talt: number; kunneTjekkes: boolean; bcAntal?: number; afvigelse?: number }> {
  const { total } = await vareTotal(countId, itemNo)
  // Varenummeret er en gyldig "stregkode" for BC's opslag, og svaret indeholder
  // beholdningen på lokationen. Derfor ingen ekstra API-side til dette.
  const bc = await resolveBarcode(itemNo, locationCode, 'optaelling')
  if (!bc || !bc.found) return { stemmer: false, talt: total, kunneTjekkes: false }
  // Afrunding: vægt i kg kan give 0,0000001 i forskel uden at nogen har talt forkert.
  const stemmer = Math.abs(bc.inventory - total) < 0.001
  // Blind tælling: kun ja/nej. Ellers tallene med, så man kan se HVOR meget der
  // mangler og straks afgøre om det er en tælefejl eller en rigtig afvigelse.
  if (blind) return { stemmer, talt: total, kunneTjekkes: true }
  return { stemmer, talt: total, kunneTjekkes: true, bcAntal: bc.inventory, afvigelse: total - bc.inventory }
}

/**
 * "Stemmer"-knappen: godkend BC's tal uden at tælle. Gemmes som BEKRÆFTET, ikke talt,
 * så man bagefter kan se forskel på at nogen har set efter, og at nogen har trykket videre.
 */
export async function bekraeftVare(
  countId: string,
  itemNo: string,
  locationCode: string,
  brugerNavn: string,
): Promise<{ ok: boolean; fejl?: string }> {
  const bc = await resolveBarcode(itemNo, locationCode, 'optaelling')
  if (!bc || !bc.found) return { ok: false, fejl: 'Varen kunne ikke slås op i BC' }
  const { antal } = await vareTotal(countId, itemNo)
  if (antal > 0) return { ok: false, fejl: 'Varen er allerede talt på denne optælling' }
  await tilfoejLinje(
    countId,
    {
      itemNo,
      description: bc.description,
      qty: bc.inventory,
      uom: bc.baseUnitOfMeasure,
      confirmed: true,
      bcQty: bc.inventory,
    },
    brugerNavn,
  )
  return { ok: true }
}

export interface OptaellingLinje {
  itemNo: string
  description: string
  total: number
  uom: string
  antal: number
  estimated: boolean
  confirmed: boolean
  shelves: string
  lotNo: string
  /** BC's beholdning da varen blev registreret. null på en blind tælling. */
  bcAntal: number | null
  afvigelse: number | null
}

/**
 * Summeret pr. vare — det BC skal have, og det kontoret ser.
 * `skjulBC` tømmer BC-tallene, så en blind tælling forbliver blind hele vejen
 * ud til skærmen og ikke kun i tjek-svaret.
 */
export async function summerPrVare(countId: string, skjulBC = false): Promise<OptaellingLinje[]> {
  await ensureOptaellingSchema()
  const rows = await prisma.$queryRaw<any[]>`
    SELECT "itemNo",
           MAX(description)                                   AS description,
           SUM(qty)                                            AS total,
           MAX(uom)                                            AS uom,
           COUNT(*)                                            AS antal,
           BOOL_OR(estimated)                                  AS estimated,
           BOOL_AND(confirmed)                                 AS confirmed,
           STRING_AGG(DISTINCT COALESCE("shelfCode",''), ', ') AS shelves,
           MAX(COALESCE("lotNo",''))                           AS lotno,
           MAX("bcQty")                                        AS bcqty
    FROM "LagerCountLine"
    WHERE "countId" = ${countId}
    GROUP BY "itemNo"
    ORDER BY "itemNo"
  `
  return rows.map(r => {
    const total = Number(r.total ?? 0)
    const bcAntal = skjulBC || r.bcqty === null || r.bcqty === undefined ? null : Number(r.bcqty)
    return {
      itemNo: r.itemNo,
      description: r.description ?? '',
      total,
      uom: r.uom ?? '',
      antal: Number(r.antal ?? 0),
      estimated: !!r.estimated,
      confirmed: !!r.confirmed,
      shelves: (r.shelves ?? '').replace(/^, |, $/g, ''),
      lotNo: r.lotno ?? '',
      bcAntal,
      afvigelse: bcAntal === null ? null : total - bcAntal,
    }
  })
}

/**
 * Sender tællingen til BC: ét hoved, én linje pr. vare, og derefter besked om at
 * skrive lageropgørelseskladden. Der BOGFØRES ikke — et menneske gør det i BC.
 */
export async function sendOptaelling(
  countId: string,
): Promise<{ ok: boolean; linjer?: number; afvigelser?: number; fejl?: string }> {
  const optaelling = await hentOptaelling(countId)
  if (!optaelling) return { ok: false, fejl: 'Optællingen findes ikke' }
  if (optaelling.status !== 'aaben') return { ok: false, fejl: `Optællingen er allerede ${optaelling.status}` }

  const linjer = await summerPrVare(countId)
  if (linjer.length === 0) return { ok: false, fejl: 'Der er ikke talt noget endnu' }

  const svar = await sendCountToBC(
    {
      no: optaelling.no,
      locationCode: optaelling.locationCode,
      countedBy: optaelling.createdByName,
      note: optaelling.note ?? '',
    },
    linjer,
  )

  if (!svar.ok) {
    await prisma.$executeRaw`
      UPDATE "LagerCount" SET "bcError" = ${svar.fejl ?? 'Ukendt fejl'} WHERE id = ${countId}
    `
    return { ok: false, fejl: svar.fejl }
  }

  await prisma.$executeRaw`
    UPDATE "LagerCount"
    SET status = 'kladde', "closedAt" = NOW(), "bcLinesWritten" = ${svar.linjer ?? 0},
        "bcDiffLines" = ${svar.afvigelser ?? 0}, "bcError" = NULL
    WHERE id = ${countId}
  `
  return { ok: true, linjer: svar.linjer, afvigelser: svar.afvigelser }
}
