// Tidslinjer til ledelsestavlen: dag for dag, pakkeri og finans.
//
// TO KILDER MED HVER SIN HISTORIK — det er vigtigt at kende grænserne:
//
//   Pakkeri  → "VM Salgslinje Log" i BC. Skrives fra den dag AL-appen gik live
//              (14-09-2026). Der er INTET at hente før den dato; salgslinjerne
//              blev slettet ved bogføring, så det kan ikke rekonstrueres.
//   Finans   → bogførte fakturalinjer, som går tilbage til 02-01-2025. Derfor
//              kan "samme dag sidste år" faktisk sammenlignes.
//
// Finanstallene aggregeres til én række pr. dag i vores egen tabel. Uden det
// skulle siden hente ~100.000 fakturalinjer ved hvert opslag.

import { prisma } from '@/lib/prisma'
import { getAccessToken, bcPortalBaseUrl } from '@/lib/businesscentral'
import { timerPrJob, pakkerTimerPrDag } from '@/lib/dantime'

// ─── Skema ───────────────────────────────────────────────────────────────────

let ensured: Promise<void> | null = null

async function run(): Promise<void> {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "SalgDag" (
      dato          TEXT PRIMARY KEY,
      omsaetning    DOUBLE PRECISION NOT NULL DEFAULT 0,
      enheder       DOUBLE PRECISION NOT NULL DEFAULT 0,
      linjer        INTEGER NOT NULL DEFAULT 0,
      fakturaer     INTEGER NOT NULL DEFAULT 0,
      "hentetAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW()
    )
  `
  // Lukkedage/helligdage fra BC's portalkalender — så en nul-dag kan skelnes fra
  // en dårlig dag. Uden det ligner 1. juledag en katastrofe.
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "LukkeDag" (
      dato        TEXT PRIMARY KEY,
      slags       TEXT NOT NULL,
      beskrivelse TEXT
    )
  `
}

export function ensureTidslinjeSkema(): Promise<void> {
  if (!ensured) {
    ensured = run().catch(err => { ensured = null; throw err })
  }
  return ensured
}

// ─── BC-hentning ─────────────────────────────────────────────────────────────

/**
 * Følger nextLink uden $top.
 *
 * Beder man BC om et bestemt antal, svarer den med præcis så mange og INGEN
 * nextLink — så løkken stopper efter første side og resten findes aldrig.
 */
async function hentAlle(sti: string): Promise<any[] | null> {
  const token = await getAccessToken()
  const ud: any[] = []
  let url: string | null = `${bcPortalBaseUrl()}/${sti}`
  let sider = 0
  while (url && sider++ < 400) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
    } as any)
    if (res.status === 404) return null
    if (!res.ok) {
      throw new Error(`BC ${sti.split('?')[0]} fejl (${res.status}): ${(await res.text()).slice(0, 200)}`)
    }
    const data = await res.json()
    ud.push(...(data.value ?? []))
    url = data['@odata.nextLink'] ?? null
  }
  return ud
}

const dagAf = (v: unknown) => String(v ?? '').slice(0, 10)

/**
 * Henter bogførte fakturalinjer i perioden og lægger dem sammen til én række
 * pr. dag. Kan køres igen på samme periode — dagene skrives forfra.
 *
 * Kreditnotaer indgår ikke: de ligger i en anden tabel i BC. Tallet er altså
 * FAKTURERET omsætning, ikke nettoomsætning. Det står også på tavlen.
 */
export async function synkSalgDage(fra: string, til: string): Promise<{ dage: number; linjer: number }> {
  await ensureTidslinjeSkema()

  const filter = encodeURIComponent(`postingDate ge ${fra} and postingDate le ${til} and type eq 'Item'`)
  const linjer = await hentAlle(
    `postedSalesInvoiceLines?$filter=${filter}&$select=postingDate,quantity,lineAmount,documentNumber`,
  )
  if (linjer === null) throw new Error('BC-appen mangler postedSalesInvoiceLines')

  type Dag = { omsaetning: number; enheder: number; linjer: number; fakturaer: Set<string> }
  const pr = new Map<string, Dag>()

  for (const l of linjer) {
    const d = dagAf(l.postingDate)
    if (!d) continue
    const e = pr.get(d) ?? { omsaetning: 0, enheder: 0, linjer: 0, fakturaer: new Set<string>() }
    e.omsaetning += Number(l.lineAmount ?? 0)
    e.enheder    += Number(l.quantity ?? 0)
    e.linjer     += 1
    if (l.documentNumber) e.fakturaer.add(String(l.documentNumber))
    pr.set(d, e)
  }

  for (const [dato, e] of Array.from(pr)) {
    await prisma.$executeRaw`
      INSERT INTO "SalgDag" (dato, omsaetning, enheder, linjer, fakturaer, "hentetAt")
      VALUES (${dato}, ${e.omsaetning}, ${e.enheder}, ${e.linjer}, ${e.fakturaer.size}, NOW())
      ON CONFLICT (dato) DO UPDATE SET
        omsaetning = EXCLUDED.omsaetning,
        enheder    = EXCLUDED.enheder,
        linjer     = EXCLUDED.linjer,
        fakturaer  = EXCLUDED.fakturaer,
        "hentetAt" = NOW()
    `
  }

  return { dage: pr.size, linjer: linjer.length }
}

/** Henter lukkedage/helligdage fra BC's portalkalender. */
export async function synkLukkedage(fra: string, til: string): Promise<number> {
  await ensureTidslinjeSkema()
  const filter = encodeURIComponent(`date ge ${fra} and date le ${til}`)
  const dage = await hentAlle(`portalCalendar?$filter=${filter}&$select=date,dayType,description`)
  if (dage === null) return 0

  let n = 0
  for (const d of dage) {
    const dato  = dagAf(d.date)
    const slags = String(d.dayType ?? '').trim()
    // Kun dage der IKKE er almindelige arbejdsdage er interessante.
    if (!dato || !slags || /^normal$/i.test(slags) || /^ ?$/.test(slags)) continue
    await prisma.$executeRaw`
      INSERT INTO "LukkeDag" (dato, slags, beskrivelse)
      VALUES (${dato}, ${slags}, ${d.description ? String(d.description) : null})
      ON CONFLICT (dato) DO UPDATE SET slags = EXCLUDED.slags, beskrivelse = EXCLUDED.beskrivelse
    `
    n++
  }
  return n
}

// ─── Finans-tidslinje ────────────────────────────────────────────────────────

export interface FinansDag {
  dato:        string
  ugedag:      number          // 1 = mandag … 7 = søndag
  omsaetning:  number
  enheder:     number
  fakturaer:   number
  /**
   * SAMMENLIGNINGEN: 52 uger tilbage, altså samme ugedag sidste år.
   *
   * I en fiskeforretning afgør ugedagen alt — fredag mod torsdag er ikke en
   * sammenligning, det er to forskellige forretninger. 25/9 2026 (fredag) stilles
   * derfor op mod 26/9 2025 (fredag), ikke mod 25/9 2025 (torsdag).
   */
  sidsteAar:        { dato: string; ugedag: number; omsaetning: number; enheder: number } | null
  /** Samme DATO sidste år — beholdt i tabellen, så man kan se begge dele. */
  sammeDato:        { dato: string; ugedag: number; omsaetning: number; enheder: number } | null
  /** Sat hvis dagen er en lukkedag/helligdag. */
  lukket?:     string
  /** Sat hvis SAMMENLIGNINGSDAGEN var lukket — så tallet ikke læses som et fald. */
  lukketSidsteAar?: string
}

function ugedagAf(iso: string): number {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay()   // 0 = søndag
  return d === 0 ? 7 : d
}

function flytDage(iso: string, dage: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dage)
  return d.toISOString().slice(0, 10)
}

function sammeDatoSidsteAar(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const forrige = new Date(Date.UTC(y - 1, m - 1, d, 12))
  return forrige.toISOString().slice(0, 10)
}

export async function finansTidslinje(fra: string, til: string): Promise<FinansDag[]> {
  await ensureTidslinjeSkema()

  // Hent bredt nok til at dække begge sammenligningspunkter i ét opslag.
  const raekker = await prisma.$queryRaw<{
    dato: string; omsaetning: number; enheder: number; fakturaer: number
  }[]>`
    SELECT dato, omsaetning, enheder, fakturaer FROM "SalgDag"
    WHERE dato >= ${flytDage(fra, -380)} AND dato <= ${til}
  `
  const kort = new Map(raekker.map(r => [r.dato, r]))

  const lukkeRaekker = await prisma.$queryRaw<{ dato: string; slags: string; beskrivelse: string | null }[]>`
    SELECT dato, slags, beskrivelse FROM "LukkeDag"
    WHERE dato >= ${flytDage(fra, -380)} AND dato <= ${til}
  `
  const lukket = new Map(lukkeRaekker.map(r => [r.dato, r.beskrivelse || r.slags]))

  const ud: FinansDag[] = []
  for (let d = fra; d <= til; d = flytDage(d, 1)) {
    const nu = kort.get(d)
    const su = flytDage(d, -364)          // 52 uger = samme ugedag sidste år
    const sd = sammeDatoSidsteAar(d)
    const suR = kort.get(su)
    const sdR = kort.get(sd)

    ud.push({
      dato:       d,
      ugedag:     ugedagAf(d),
      omsaetning: nu?.omsaetning ?? 0,
      enheder:    nu?.enheder ?? 0,
      fakturaer:  nu?.fakturaer ?? 0,
      sidsteAar:  suR ? { dato: su, ugedag: ugedagAf(su), omsaetning: suR.omsaetning, enheder: suR.enheder } : null,
      sammeDato:  sdR ? { dato: sd, ugedag: ugedagAf(sd), omsaetning: sdR.omsaetning, enheder: sdR.enheder } : null,
      lukket:          lukket.get(d),
      // Lukkedagen der betyder noget er den vi SAMMENLIGNER med — ellers ser et
      // fald ud som en nedgang, når den rigtige forklaring er at der var lukket.
      lukketSidsteAar: lukket.get(su),
    })
  }
  return ud
}

// ─── Pakkeri-tidslinje ───────────────────────────────────────────────────────

export interface PakkerDag {
  pakker:  string
  linjer:  number
  scannet: number
  /** Stemplede timer på pakkeri-jobbet. Null når personen ikke er koblet. */
  timer:   number | null
}

export interface PakkeriDag {
  dato:     string
  ugedag:   number
  linjer:   number
  scannet:  number
  /** Stemplede timer i pakkeriet (Dan-Time). Null hvis dagen ikke er samplet. */
  timer:    number | null
  /**
   * Timer for de pakkere vi KAN følge — dem der både er koblet til en
   * pakkerkode og har stemplet ind. Sammen med `linjerKoblede` giver det en
   * ærlig rate: samme mennesker i tæller og nævner.
   */
  timerKoblede:  number
  /** Linjer pakket af netop de mennesker. */
  linjerKoblede: number
  pakkere:  PakkerDag[]
}

export interface PakkeriTidslinje {
  dage:     PakkeriDag[]
  /** Navne på alle pakkere i perioden — til faste farver og forklaring. */
  pakkere:  string[]
  /** Første dag der overhovedet findes data for. */
  starter:  string | null
  mangler?: string
}

export async function pakkeriTidslinje(fra: string, til: string, jobNr = '16'): Promise<PakkeriTidslinje> {
  await ensureTidslinjeSkema()

  const filter = encodeURIComponent(`shipmentDate ge ${fra} and shipmentDate le ${til} and deleted eq false`)
  const log = await hentAlle(`salesEntries?$filter=${filter}&$select=shipmentDate,packedBy,scanned`)
  if (log === null) {
    return { dage: [], pakkere: [], starter: null, mangler: 'BC-appen mangler salesEntries (side 50451)' }
  }

  // Dan-Time-timer hentes pr. dag; kun dage hvor der faktisk er samplet.
  const dagListe: string[] = []
  for (let d = fra; d <= til; d = flytDage(d, 1)) dagListe.push(d)
  const timerPrDag = new Map<string, number | null>()
  // Timer pr. PERSON kræver koblingen mellem pakkerkode og Dan-Time-medarbejder
  // (sættes i admin). Er den ikke sat, står personens timer som null i stedet
  // for som nul — nul ville se ud som om vedkommende pakkede uden at være der.
  const prPersonPrDag = new Map<string, Map<string, number>>()
  await Promise.all(dagListe.map(async d => {
    try {
      const job = (await timerPrJob(d)).find(j => j.jobNr === jobNr)
      timerPrDag.set(d, job ? job.timer : null)
    } catch { timerPrDag.set(d, null) }
    try {
      const folk = await pakkerTimerPrDag(d, jobNr)
      prPersonPrDag.set(d, new Map(folk.map(f => [f.kode, f.timer])))
    } catch { prPersonPrDag.set(d, new Map()) }
  }))

  type Akk = { linjer: number; scannet: number; pakkere: Map<string, PakkerDag> }
  const pr = new Map<string, Akk>()
  const alle = new Set<string>()

  for (const r of log) {
    const d = dagAf(r.shipmentDate)
    const navn = String(r.packedBy ?? '').trim()
    if (!d || !navn) continue
    alle.add(navn)
    const a = pr.get(d) ?? { linjer: 0, scannet: 0, pakkere: new Map<string, PakkerDag>() }
    a.linjer++
    if (r.scanned === true) a.scannet++
    const p = a.pakkere.get(navn) ?? { pakker: navn, linjer: 0, scannet: 0, timer: null }
    p.linjer++
    if (r.scanned === true) p.scannet++
    a.pakkere.set(navn, p)
    pr.set(d, a)
  }

  // Læg personens stemplede timer på, hvor koblingen findes.
  for (const [d, a] of Array.from(pr)) {
    const folk = prPersonPrDag.get(d)
    if (!folk) continue
    for (const p of Array.from(a.pakkere.values())) {
      const t = folk.get(p.pakker)
      if (t !== undefined) p.timer = t
    }
  }

  const dage: PakkeriDag[] = dagListe
    .filter(d => pr.has(d))
    .map(d => {
      const a = pr.get(d)!
      const folk = Array.from(a.pakkere.values()).sort((x, y) => y.linjer - x.linjer)
      // Kun de pakkere der faktisk stempler tæller i produktivitets-raten.
      // Regner man ALLE linjer mod de stemplede timer, bliver tallet for højt:
      // JAN, HÅKON og LINE pakker uden at være i Dan-Time, så deres linjer ville
      // blive lagt oven i andres timer.
      const koblede = folk.filter(p => p.timer !== null && p.timer > 0)
      return {
        dato:    d,
        ugedag:  ugedagAf(d),
        linjer:  a.linjer,
        scannet: a.scannet,
        timer:   timerPrDag.get(d) ?? null,
        timerKoblede:  Math.round(koblede.reduce((s, p) => s + (p.timer ?? 0), 0) * 100) / 100,
        linjerKoblede: koblede.reduce((s, p) => s + p.linjer, 0),
        pakkere: folk,
      }
    })

  return {
    dage,
    // Fast rækkefølge: den der har pakket mest i perioden får slot 1 og beholder
    // sin farve uanset hvilke dage der vises. Farve følger personen, ikke rangen.
    pakkere: Array.from(alle).sort(),
    starter: dage.length ? dage[0].dato : null,
  }
}
