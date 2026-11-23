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
import { resolveBarcode } from '@/lib/lager/bc'
import { sendEmail } from '@/lib/email'

/**
 * Varenumre fra og med dette tal vises IKKE på salgsskærmen (Claus 22-11).
 *
 * Grænsen hører til VISNINGEN, ikke til printet: kanban-kortene bruges mest over
 * 90000 — emballage, rengøring, reservedele — men netop de varer er salgsafdelingen
 * uvedkommende. Deres meldinger er indkøberens.
 *
 * Signalet gemmes altid. Det er kun skærmen, der filtrerer — bestillingsappen viser
 * ALLE åbne meldinger, se `alleAabneSignaler`.
 *
 * Tallet står KUN her. Dubletten i BC cu 50652 blev fjernet 22-11: to tal der skal
 * betyde det samme er ét for mange.
 */
export const SALGSSKAERM_MAX_VARENR = 90000

export interface KanbanRaekke {
  id:          string
  itemNo:      string
  description: string
  /** Varens hylde fra varekortet, som den stod ved meldingen. Tom når BC ikke har en. */
  shelfNo:     string
  baseUom:     string
  bcInventory: number | null
  antal:       number
  firstAt:     string
  lastAt:      string
  meldtAf:     string
  /** Besked fra den, der meldte — skrevet eller indtalt. Tom, når der ingen er. */
  note:        string
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
  // Tilføjet 22-11: hylden med i snapshottet, så den der skal hente varen kan se
  // HVOR den står — både på kontorskærmen og i bestillingsappen.
  await prisma.$executeRaw`ALTER TABLE "KanbanSignal" ADD COLUMN IF NOT EXISTS "shelfNo" TEXT NOT NULL DEFAULT ''`
  // Tilføjet 23-11: beskeden fra den der melder. Håndterminalen kan skrive den eller
  // indtale den, og den følger med i mailen til kontoret.
  await prisma.$executeRaw`ALTER TABLE "KanbanSignal" ADD COLUMN IF NOT EXISTS "note" TEXT NOT NULL DEFAULT ''`
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

/**
 * Varens hylde. Et selvstændigt opslag, fordi hylden ikke findes i standard-API'ets
 * varefelter — kun i vores eget stregkodeopslag (side 50600).
 *
 * Det er bevidst et EKSTRA kald og ikke en erstatning for `hentVare`: beholdningen på
 * kontorskærmen kommer derfra i dag, og de to kilder tæller ikke nødvendigvis på samme
 * lokationer. Et pænere kald, der ændrede tallet på væggen, ville ikke være pænere.
 *
 * Kaldet sker kun når en hylde meldes tom FØRSTE gang — nogle gange om dagen.
 */
export async function hentHylde(itemNo: string): Promise<string> {
  const svar = await resolveBarcode(itemNo, '', 'kanban').catch(() => null)
  return svar?.found ? svar.shelfNo : ''
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
export async function meldTom(itemNo: string, meldtAf: string, note = '') {
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
        // En ny besked erstatter den gamle; INGEN besked lader den gamle stå.
        // Melder nummer to siger ikke noget, betyder det ikke, at nummer et tog
        // sit "der står kun brækkede kasser tilbage" i sig igen.
        note:    note || findes.note,
      },
    })
  }

  // Snapshot af varen, så skærmen kan vises uden et BC-kald pr. række. Svarer BC
  // ikke, melder vi alligevel: en tom hylde er en tom hylde, også når BC er nede.
  const [vare, hylde] = await Promise.all([
    hentVare(itemNo).catch(() => null),
    hentHylde(itemNo).catch(() => ''),
  ])

  return prisma.kanbanSignal.create({
    data: {
      itemNo,
      description: vare?.description ?? '',
      shelfNo:     hylde,
      baseUom:     vare?.baseUom ?? '',
      bcInventory: vare?.inventory ?? null,
      meldtAf,
      note,
    },
  })
}

/**
 * Mail til kontoret, når en hylde meldes tom.
 *
 * Kontorskærmen er god til "hvad mangler lige nu", men den kræver, at nogen kigger op.
 * Mailen er det, der gør, at indkøberen ved det MED DET SAMME (Claus 23-11) — og det
 * er hele grunden til, at terminalen må melde tomt, mens man tæller op.
 *
 * Kaster ALDRIG videre: en melding må ikke gå tabt, fordi SMTP er nede. Men den
 * logges, for en tavs `if (!ok) return` er sådan et 404 kan gemme sig i månedsvis,
 * se [[feedback_log_silent_bc_write_failures]].
 */
export async function sendTomHyldeVarsel(opts: {
  itemNo:      string
  description: string
  shelfNo:     string
  baseUom:     string
  bcInventory: number | null
  antal:       number
  meldtAf:     string
  note:        string
}) {
  const { itemNo, description, shelfNo, baseUom, bcInventory, antal, meldtAf, note } = opts
  const base = process.env.NEXTAUTH_URL ?? 'https://portal.venmark.dk'
  const navn = description ? `${itemNo} — ${description}` : itemNo

  const linjer = [
    `Vare:        ${navn}`,
    shelfNo ? `Hylde:       ${shelfNo}` : '',
    bcInventory !== null ? `BC siger:    ${bcInventory} ${baseUom}` : '',
    `Meldt af:    ${meldtAf || 'ikke logget ind'}`,
    antal > 1 ? `Meldt:       ${antal}. gang — den er stadig tom` : '',
    '',
    note ? `Besked fra lageret:\n"${note}"` : 'Ingen besked med.',
    '',
    `Luk meldingen: ${base}/k/${encodeURIComponent(itemNo)}`,
  ].filter(l => l !== '')

  try {
    await sendEmail({
      to:      process.env.NOTIFICATION_EMAIL ?? 'fisk@venmark.dk',
      subject: `Tom hylde: ${navn}`,
      text:    `Hylden er meldt tom fra lager-appen.\n\n${linjer.join('\n')}\n`,
      html:
        `<p><strong>Hylden er meldt tom fra lager-appen.</strong></p>` +
        `<table cellpadding="4"><tbody>` +
        `<tr><td>Vare</td><td><strong>${esc(navn)}</strong></td></tr>` +
        (shelfNo ? `<tr><td>Hylde</td><td>${esc(shelfNo)}</td></tr>` : '') +
        (bcInventory !== null ? `<tr><td>BC siger</td><td>${bcInventory} ${esc(baseUom)}</td></tr>` : '') +
        `<tr><td>Meldt af</td><td>${esc(meldtAf || 'ikke logget ind')}</td></tr>` +
        (antal > 1 ? `<tr><td>Meldt</td><td>${antal}. gang — den er stadig tom</td></tr>` : '') +
        `</tbody></table>` +
        (note
          ? `<p><strong>Besked fra lageret:</strong><br><em>${esc(note)}</em></p>`
          : `<p>Ingen besked med.</p>`) +
        `<p><a href="${base}/k/${encodeURIComponent(itemNo)}">Luk meldingen</a></p>`,
    })
  } catch (e) {
    console.error(`[kanban] mail om tom hylde ${itemNo} kunne ikke sendes:`, e)
  }
}

/** Mindste tegnsætning, så et varenavn med & eller < ikke river mailen i stykker. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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
      shelfNo:     r.shelfNo ?? '',
      baseUom:     r.baseUom,
      bcInventory: r.bcInventory === null ? null : Number(r.bcInventory),
      antal:       r.antal,
      firstAt:     r.firstAt.toISOString(),
      lastAt:      r.lastAt.toISOString(),
      meldtAf:     r.meldtAf,
      note:        r.note ?? '',
    }))
}

/**
 * ALLE åbne meldinger — til bestillingsappen.
 *
 * Her er der INGEN 90000-grænse, og det er hele pointen: kanban-kortene bruges mest
 * over 90000 (emballage, rengøring, reservedele), og netop de meldinger er
 * indkøberens. Uden denne liste ville de blive meldt og aldrig set af nogen: de står
 * ikke på salgsskærmen, og ingen går og leder i en database.
 *
 * Ældste først: en hylde der har været tom længst, skal bestilles først.
 */
export async function alleAabneSignaler(limit = 50): Promise<KanbanRaekke[]> {
  await ensureKanbanSchema()

  const raekker = await prisma.kanbanSignal.findMany({
    where:   { status: 'aaben' },
    orderBy: { firstAt: 'asc' },
    take:    Math.min(limit, 200),
  })

  return raekker.map(r => ({
    id:          r.id,
    itemNo:      r.itemNo,
    description: r.description,
    shelfNo:     r.shelfNo ?? '',
    baseUom:     r.baseUom,
    bcInventory: r.bcInventory === null ? null : Number(r.bcInventory),
    antal:       r.antal,
    firstAt:     r.firstAt.toISOString(),
    lastAt:      r.lastAt.toISOString(),
    meldtAf:     r.meldtAf,
    note:        r.note ?? '',
  }))
}
