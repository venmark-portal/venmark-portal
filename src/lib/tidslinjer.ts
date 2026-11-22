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
import { saelgerAf } from '@/lib/saelgere'

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
    `postedSalesInvoiceLines?$filter=${filter}` +
    `&$select=postingDate,quantity,quantityBase,unitOfMeasureCode,lineAmount,documentNumber`,
  )
  if (linjer === null) throw new Error('BC-appen mangler postedSalesInvoiceLines')

  type Dag = { omsaetning: number; enheder: number; linjer: number; fakturaer: Set<string> }
  const pr = new Map<string, Dag>()

  for (const l of linjer) {
    const d = dagAf(l.postingDate)
    if (!d) continue
    const e = pr.get(d) ?? { omsaetning: 0, enheder: 0, linjer: 0, fakturaer: new Set<string>() }
    e.omsaetning += Number(l.lineAmount ?? 0)

    // MÆNGDE: `quantity` står i LINJENS enhed, og der er 25 forskellige i brug —
    // KG, STK, BAKKE, DÅSE, 10 L DUNK. At lægge dem sammen svarer til at addere
    // kilo og stykker: den 29-08-2025 var 31.632 af dagens 34.769 "enheder" to
    // linjer fiskeafskær i STK, og de druknede alt andet.
    //
    // `quantityBase` er omregnet til varens basisenhed og er det eneste tal der
    // kan summeres på tværs. Det kommer først med BC-app 29.0.147.399; indtil
    // den er inde falder vi tilbage på KUN kg-linjerne, som i det mindste er
    // sammenlignelige indbyrdes.
    const basis = Number(l.quantityBase ?? 0)
    if (basis) e.enheder += basis
    else if (String(l.unitOfMeasureCode ?? '').trim().toUpperCase() === 'KG') {
      e.enheder += Number(l.quantity ?? 0)
    }

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
    // Weekender og lukkeperioder er nul i BEGGE år og gør kun kurven til en
    // savklinge. Springes de over, ligger arbejdsdagene side om side og trenden
    // kan ses. En dag hvor bare ét af årene har omsætning, bliver stående — så
    // en lukkedag vi handlede sidste år stadig er synlig.
    const nu = kort.get(d)
    const su = flytDage(d, -364)          // 52 uger = samme ugedag sidste år
    const sd = sammeDatoSidsteAar(d)
    const suR = kort.get(su)
    const sdR = kort.get(sd)

    if ((nu?.omsaetning ?? 0) === 0 && (suR?.omsaetning ?? 0) === 0) continue

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

// ─── Salg pr. sælger ─────────────────────────────────────────────────────────

export interface SaelgerDag {
  kode:   string
  linjer: number
  /** Linjer via Hurtig ordreindtastning (portalen tæller altid her). */
  hurtig: number
}

export interface SalgDagPrSaelger {
  dato:     string
  ugedag:   number
  linjer:   number
  saelgere: SaelgerDag[]
}

export interface SalgTidslinje {
  dage:     SalgDagPrSaelger[]
  /** Alfabetisk — farven følger koden hen over perioder. */
  saelgere: string[]
  mangler?: string
}

/** Navnet på linjer uden sælgerkode. Holdes i sync med Tidslinjer.tsx. */
export const UDEN_SAELGER = 'Ingen sælger'

/**
 * Oprettede salgslinjer pr. dag pr. sælgerkode, fra salgslinje-loggen.
 *
 * Dagen er OPRETTELSESdagen (hvornår salget blev taget), ikke afsendelsesdagen —
 * det er sælgerens arbejdsdag der skal måles. Linjer der er slettet igen af en
 * bruger tæller ikke; bogførte linjer gør (de er jo netop solgt). Portalens linjer
 * står under koden "Portal" (sat af cu 50431), så webordrer er deres egen søjle.
 */
export async function salgTidslinje(fra: string, til: string): Promise<SalgTidslinje> {
  const filter = encodeURIComponent(`createdDate ge ${fra} and createdDate le ${til} and deleted eq false`)
  const log = await hentAlle(`salesEntries?$filter=${filter}&$select=createdDate,salespersonCode,quickEntry,customerNo,documentNo`)
  if (log === null) return { dage: [], saelgere: [], mangler: 'BC-appen mangler salesEntries (side 50451)' }

  const pr = new Map<string, { linjer: number; s: Map<string, SaelgerDag> }>()
  const alle = new Set<string>()
  for (const r of log) {
    const d = dagAf(r.createdDate)
    if (!d) continue
    // Netfisk-ordrer tæller som webshoppens eget salg, ikke debitorens faste sælger.
    const kode = saelgerAf({ salespersonCode: r.salespersonCode, customerNo: r.customerNo, documentNo: r.documentNo }) || UDEN_SAELGER
    alle.add(kode)
    const a = pr.get(d) ?? { linjer: 0, s: new Map<string, SaelgerDag>() }
    a.linjer++
    const s = a.s.get(kode) ?? { kode, linjer: 0, hurtig: 0 }
    s.linjer++
    if (r.quickEntry === true) s.hurtig++
    a.s.set(kode, s)
    pr.set(d, a)
  }

  const dage = Array.from(pr.entries())
    .map(([dato, a]) => ({
      dato, ugedag: ugedagAf(dato), linjer: a.linjer,
      saelgere: Array.from(a.s.values()).sort((x, y) => y.linjer - x.linjer),
    }))
    .sort((a, b) => a.dato.localeCompare(b.dato))

  // "Ingen sælger" sidst: den er ikke en person og skal ikke stå mellem koderne.
  const saelgere = Array.from(alle).sort((a, b) =>
    a === UDEN_SAELGER ? 1 : b === UDEN_SAELGER ? -1 : a.localeCompare(b, 'da'))

  return { dage, saelgere }
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

// ─── Produktion: kg pr. mandetime pr. afdeling ───────────────────────────────
//
// Kg kommer fra BC (prodYields = tabel 50205, én række pr. produkt pr. bogført
// montage). Afdelingen er montagens Dan-Time-jobnummer (postedProdOrders), og
// timerne er Dan-Time-stemplinger på samme job samme dag.
//
// DAGEN er afslutningsdagen ("Afsluttet Kl."), ikke bogføringsdagen — der
// bogføres ofte dagen efter, og så ville kiloene lande på en dag uden timer.
//
// KUN DÆKKEDE DAGE tæller i forholdstallene. Dan-Time samples af portalen; er
// samplingen nede en dag (14.-15. og 22.-23. oktober 2026), mangler timerne mens
// kiloene står der stadig, og kg pr. time ville springe til det dobbelte. En dag
// er dækket når der i alt er stemplet mindst DAEKKET_MIN_TIMER — en normal
// hverdag ligger på 300+. Stemplingerne findes fra 08-09-2026.

const DAEKKET_MIN_TIMER = 100

export interface ProdPerson { navn: string; timer: number }

export interface ProdAfdeling {
  jobNr:        string
  jobNavn:      string
  produktioner: number
  raaKg:        number
  outKg:        number
  timer:        number
  /** Null når der ingen timer er, eller råvaren ikke bogføres på montagen. */
  raaPrTime:    number | null
  outPrTime:    number | null
  udbytte:      number | null
  personer:     ProdPerson[]
  /** Sat når tallene ikke kan bruges — forklaringen står her. */
  advarsel?:    string
}

export interface ProdDagAfdeling { jobNr: string; raaKg: number; outKg: number; timer: number }

export interface ProdDag {
  dato:      string
  ugedag:    number
  daekket:   boolean
  /** Stemplede timer i alt den dag (alle job) — viser hvorfor en dag er udækket. */
  timerIAlt: number
  afdelinger: ProdDagAfdeling[]
}

export interface ProduktionTidslinje {
  dage:        ProdDag[]
  /** Sorteret efter råvare-kg, størst først. */
  afdelinger:  ProdAfdeling[]
  /** Montager uden jobnummer — kan ikke lægges på en afdeling. */
  udenJob:     { produktioner: number; raaKg: number; outKg: number }
  udaekkede:   string[]
  /** Første dag med Dan-Time-data overhovedet. */
  timerFra:    string | null
  mangler?:    string
}

const minAf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const r1 = (n: number) => Math.round(n * 10) / 10

export async function produktionTidslinje(fra: string, til: string): Promise<ProduktionTidslinje> {
  // ── BC: bogførte montager + udbytterækker. Én uge ad gangen: BC returnerer i
  // nøglerækkefølge og nextLink udløber på brede kald (se produktionsskærmen).
  // Bogføringsvinduet går en uge ud over perioden, så en montage afsluttet den
  // 30. og bogført den 1. stadig kommer med.
  const vinduer: [string, string][] = []
  const slut = flytDage(til, 7)
  for (let d = fra; d <= slut; d = flytDage(d, 7)) {
    const t = flytDage(d, 6)
    vinduer.push([d, t > slut ? slut : t])
  }
  const svar = await Promise.all(vinduer.map(async ([f, t]) => {
    const filter = encodeURIComponent(`postingDate ge ${f} and postingDate le ${t}`)
    const [o, y] = await Promise.all([
      hentAlle(`postedProdOrders?$filter=${filter}&$select=no,orderNo,postingDate,afsluttetKl,danTimeJobNo`),
      hentAlle(`prodYields?$filter=${filter}&$select=productionNo,actualQty,rawQty`),
    ])
    return { o, y }
  }))
  if (svar.some(s => s.o === null || s.y === null)) {
    return { dage: [], afdelinger: [], udenJob: { produktioner: 0, raaKg: 0, outKg: 0 }, udaekkede: [], timerFra: null,
             mangler: 'BC-appen mangler postedProdOrders eller prodYields' }
  }

  const tilDag = (s: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(new Date(s))
  const montage = new Map<string, { job: string; dag: string }>()
  for (const { o } of svar) for (const r of o!) {
    const kl = String(r.afsluttetKl ?? '')
    const dag = kl && !kl.startsWith('0001') ? tilDag(kl) : dagAf(r.postingDate)
    const m = { job: String(r.danTimeJobNo ?? '').trim(), dag }
    // Udbytterækkerne bærer montagens nummer; det er det samme før og efter bogføring.
    if (r.no) montage.set(String(r.no), m)
    if (r.orderNo) montage.set(String(r.orderNo), m)
  }

  // Pr. montage: output = summen af produkterne; råvaren står på hver række og
  // er den samme for hele montagen, så den tages én gang (største værdi).
  const kg = new Map<string, { raa: number; out: number }>()
  for (const { y } of svar) for (const r of y!) {
    const nr = String(r.productionNo ?? '')
    if (!nr) continue
    const k = kg.get(nr) ?? { raa: 0, out: 0 }
    k.raa = Math.max(k.raa, Number(r.rawQty ?? 0))
    k.out += Number(r.actualQty ?? 0)
    kg.set(nr, k)
  }

  // ── Dan-Time ──
  const stempl = await prisma.$queryRaw<{
    dato: string; navn: string; jobNr: string | null; jobNavn: string | null; ind: string; ud: string | null
  }[]>`
    SELECT dato, navn, "jobNr", "jobNavn", ind, ud FROM "DanTimeStempling"
    WHERE dato >= ${fra} AND dato <= ${til}
  `
  const foerste = await prisma.$queryRaw<{ min: string | null }[]>`SELECT MIN(dato) AS min FROM "DanTimeStempling"`

  const idag = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(new Date())
  const nu = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Copenhagen', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  }).format(new Date())

  const timerIAlt = new Map<string, number>()
  const navne = new Map<string, string>()
  // dag → job → { minutter, person → minutter }
  const tid = new Map<string, Map<string, { min: number; folk: Map<string, number> }>>()
  for (const s of stempl) {
    // Uden UD: i dag er personen stadig på arbejde; en tidligere dag har en
    // glemt udstempling, og den kan vi ikke gætte længden af.
    const ud = s.ud ?? (s.dato === idag ? nu : null)
    if (!ud) continue
    let m = minAf(ud) - minAf(s.ind)
    if (m < 0) m += 24 * 60
    if (m <= 0) continue
    timerIAlt.set(s.dato, (timerIAlt.get(s.dato) ?? 0) + m)
    const job = String(s.jobNr ?? '').trim()
    if (!job) continue
    if (s.jobNavn) navne.set(job, s.jobNavn)
    const dag = tid.get(s.dato) ?? new Map()
    const j = dag.get(job) ?? { min: 0, folk: new Map<string, number>() }
    j.min += m
    j.folk.set(s.navn, (j.folk.get(s.navn) ?? 0) + m)
    dag.set(job, j)
    tid.set(s.dato, dag)
  }
  const daekket = (d: string) => (timerIAlt.get(d) ?? 0) >= DAEKKET_MIN_TIMER * 60

  // ── Saml pr. dag og pr. afdeling ──
  type Akk = { produktioner: number; raa: number; out: number; min: number; folk: Map<string, number> }
  const afd = new Map<string, Akk>()
  const A = (j: string) => {
    let a = afd.get(j)
    if (!a) { a = { produktioner: 0, raa: 0, out: 0, min: 0, folk: new Map() }; afd.set(j, a) }
    return a
  }
  const pDag = new Map<string, Map<string, ProdDagAfdeling>>()
  const P = (d: string, j: string) => {
    const dag = pDag.get(d) ?? new Map<string, ProdDagAfdeling>()
    pDag.set(d, dag)
    let x = dag.get(j)
    if (!x) { x = { jobNr: j, raaKg: 0, outKg: 0, timer: 0 }; dag.set(j, x) }
    return x
  }
  const udenJob = { produktioner: 0, raaKg: 0, outKg: 0 }

  for (const [nr, k] of Array.from(kg)) {
    const m = montage.get(nr)
    if (!m || m.dag < fra || m.dag > til) continue
    // Uden jobnummer tælles hele perioden: det er en liste over hvad der
    // mangler, ikke et forholdstal.
    if (!m.job) {
      udenJob.produktioner++; udenJob.raaKg += k.raa; udenJob.outKg += k.out
      continue
    }
    const p = P(m.dag, m.job)
    p.raaKg += k.raa; p.outKg += k.out
    if (!daekket(m.dag)) continue
    const a = A(m.job)
    a.produktioner++; a.raa += k.raa; a.out += k.out
  }

  for (const [d, jobs] of Array.from(tid)) {
    for (const [j, t] of Array.from(jobs)) {
      P(d, j).timer += t.min / 60
      if (!daekket(d)) continue
      const a = A(j)
      a.min += t.min
      for (const [n, m] of Array.from(t.folk)) a.folk.set(n, (a.folk.get(n) ?? 0) + m)
    }
  }

  // Kun afdelinger der har produceret noget i perioden — ellers fyldes listen
  // med vasketøj, ferie og kontorrengøring.
  const afdelinger: ProdAfdeling[] = Array.from(afd)
    .filter(([, a]) => a.produktioner > 0)
    .map(([jobNr, a]) => {
      const timer = a.min / 60
      // Råvaren bogføres ikke altid på montagen (skrabe-linjen: 14 kg råvare mod
      // 751 kg output i oktober 2026). Så er både kg/time på råvare og udbyttet
      // meningsløse — de skjules frem for at stå med et tal der ser rigtigt ud.
      const raaMangler = a.out > 0 && a.raa < a.out * 0.5
      return {
        jobNr,
        jobNavn:      navne.get(jobNr) ?? `Job ${jobNr}`,
        produktioner: a.produktioner,
        raaKg:        Math.round(a.raa),
        outKg:        Math.round(a.out),
        timer:        r1(timer),
        raaPrTime:    timer > 0 && !raaMangler ? r1(a.raa / timer) : null,
        outPrTime:    timer > 0 ? r1(a.out / timer) : null,
        udbytte:      a.raa > 0 && !raaMangler ? r1((a.out / a.raa) * 100) : null,
        personer:     Array.from(a.folk).map(([navn, m]) => ({ navn, timer: r1(m / 60) }))
                        .sort((x, y) => y.timer - x.timer),
        advarsel:     raaMangler
          ? 'Råvaren bogføres ikke på montagerne her — kun output kan regnes.'
          : timer === 0 ? 'Ingen stemplede timer på afdelingen.' : undefined,
      }
    })
    .sort((a, b) => b.raaKg - a.raaKg || b.outKg - a.outKg)

  const vist = new Set(afdelinger.map(a => a.jobNr))
  const dage: ProdDag[] = []
  for (let d = fra; d <= til; d = flytDage(d, 1)) {
    const jobs = Array.from(pDag.get(d)?.values() ?? []).filter(x => vist.has(x.jobNr))
    const t = (timerIAlt.get(d) ?? 0) / 60
    // Weekender uden hverken kg eller timer springes over, som på de andre tavler.
    if (!jobs.some(x => x.raaKg || x.outKg) && t < 1) continue
    dage.push({
      dato: d, ugedag: ugedagAf(d), daekket: daekket(d), timerIAlt: r1(t),
      afdelinger: jobs.map(x => ({ ...x, raaKg: Math.round(x.raaKg), outKg: Math.round(x.outKg), timer: r1(x.timer) })),
    })
  }

  return {
    dage,
    afdelinger,
    udenJob: { produktioner: udenJob.produktioner, raaKg: Math.round(udenJob.raaKg), outKg: Math.round(udenJob.outKg) },
    // Kun hverdage med NOGET stemplet men for lidt — en weekend er ikke et hul.
    udaekkede: dage.filter(d => !d.daekket && d.afdelinger.some(x => x.raaKg || x.outKg)).map(d => d.dato),
    timerFra: foerste[0]?.min ?? null,
  }
}
