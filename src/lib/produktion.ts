// Produktionsdata til skærmene: udbytte på lukkede montager, og hvad der kører nu.

import { getAccessToken, bcPortalBaseUrl } from '@/lib/businesscentral'
import { hvemErPaaJobNu, hvemVarPaaJob, timerPrJob, copenhagenDato, type PaaJob } from '@/lib/dantime'

/** BC leverer UTC; Dan-Time og skærmen arbejder i dansk tid. */
function danskDel(iso: string, opt: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', ...opt }).format(new Date(iso))
}
function danskDato(iso: string): string {
  const [d, m, a] = danskDel(iso, { year: 'numeric', month: '2-digit', day: '2-digit' }).split('/')
  return `${a}-${m}-${d}`
}
function danskKlokken(iso: string): string {
  return danskDel(iso, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

/** Initialer på skærmen — fulde navne fylder for meget. Mangler de, brug navnet. */
function tilMedarbejdere(folk: PaaJob[]): Medarbejder[] {
  return folk.map(p => ({ navn: p.navn, lonnr: p.lonnr, initialer: p.initialer || p.navn }))
}

// Venmark "snyder" systemet på nogle produktioner (fx råvare 0,1 kg for at tvinge
// noget igennem), og der er fejlbehæftede rækker. Uden disse to filtre viser
// skærmen udbytter på 10.620 % — Claus 2026-09-08.
const ITEM_FRA = 10000
const ITEM_TIL = 25000
const MIN_RAAVARE_KG = 25

function iVaresortiment(itemNo: string): boolean {
  const n = Number(String(itemNo).trim())
  return Number.isFinite(n) && n >= ITEM_FRA && n <= ITEM_TIL
}

/**
 * BC returnerer rækker i NØGLErækkefølge og sider dem op uanset $top. Følger man
 * ikke nextLink, får man de ÆLDSTE montager og tror det er de nyeste — præcis
 * den fælde udbytte-skærmen faldt i første gang.
 */
async function bcHent(sti: string, params: Record<string, string>, maxSider = 20): Promise<any[]> {
  const token   = await getAccessToken()
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')

  let url: string | null = `${bcPortalBaseUrl()}/${sti}?${qs}`
  const alle: any[] = []
  for (let side = 0; url && side < maxSider; side++) {
    const res: Response = await fetch(url, { headers, cache: 'no-store' })
    if (!res.ok) {
      // En udløbet nextLink må ikke koste os det vi allerede har hentet.
      if (side > 0) break
      throw new Error(`BC ${sti} fejl (${res.status}): ${(await res.text()).slice(0, 200)}`)
    }
    const data = await res.json()
    alle.push(...(data.value ?? []))
    url = data['@odata.nextLink'] ?? null
  }
  return alle
}

// ─── Udbytte på lukkede montager ─────────────────────────────────────────────

export interface UdbytteRaekke {
  productionNo: string
  postingDate:  string
  rawQty:       number
  /** Hovedvarens navn og udbytte. Er intet markeret som Hoved, tages den største. */
  hovedNavn:    string
  hovedPct:     number
  /** Alle øvrige produkter lagt sammen til ét tal. */
  biproduktPct: number
  ialtPct:      number
  /** true = ingen vare var markeret som Hoved; vi gættede på den største. */
  hovedGaettet: boolean
}

/**
 * De seneste `antal` bogførte montager, én række pr. montage.
 *
 * Bemærk: kun produkter i varenummer-intervallet tælles med, så "i alt" er
 * udbyttet af DE viste produkter — ikke nødvendigvis hele montagen.
 */
export async function sidsteUdbytter(antal = 10): Promise<UdbytteRaekke[]> {
  // Én uge ad gangen, nyeste først, indtil vi har nok montager.
  //
  // Hvorfor ikke ét stort kald: BC sider resultatet op uanset $top og returnerer
  // i NØGLErækkefølge (produktionsnr.), og nextLinks udløber. Et bredt kald gav
  // derfor de ÆLDSTE montager — skærmen viste 31. august som "senest lukkede",
  // selvom der var bogført montager samme dag.
  const dag = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)
  const raekker: any[] = []
  const brugbar = (r: any) =>
    iVaresortiment(r.itemNo) && Number(r.rawQty) >= MIN_RAAVARE_KG && Number(r.actualYieldPct) > 0

  for (let uge = 0; uge < 8; uge++) {
    raekker.push(...await bcHent("prodYields", {
      "$filter": `postingDate ge ${dag(7 * (uge + 1))} and postingDate le ${dag(7 * uge)}`,
      "$top":    "1000",
    }))
    if (new Set(raekker.filter(brugbar).map(r => r.productionNo)).size >= antal) break
  }

  const pr = new Map<string, any[]>()
  for (const r of raekker.filter(brugbar)) {
    const l = pr.get(r.productionNo) ?? []
    l.push(r)
    pr.set(r.productionNo, l)
  }

  const ud: UdbytteRaekke[] = []
  const pct = (r: any) => Number(r.actualYieldPct)
  for (const [nr, rs] of Array.from(pr)) {
    let hoved: any[] = rs.filter((r: any) => r.outputType === 'Hoved')
    let gaettet = false
    if (hoved.length === 0) {
      // Tre ud af fire montager har INGEN vare markeret som Hoved — så ville
      // kolonnen stå tom. Vi tager den største og markerer at det er et gæt.
      hoved = [rs.reduce((a: any, b: any) => (pct(a) >= pct(b) ? a : b))]
      gaettet = true
    }
    const hovedSum = hoved.reduce((s: number, r: any) => s + pct(r), 0)
    const ialt     = rs.reduce((s: number, r: any) => s + pct(r), 0)
    ud.push({
      productionNo: nr,
      postingDate:  String(rs[0].postingDate).slice(0, 10),
      rawQty:       Number(rs[0].rawQty),
      hovedNavn:    String(hoved[0].description ?? hoved[0].itemNo),
      hovedPct:     hovedSum,
      biproduktPct: ialt - hovedSum,
      ialtPct:      ialt,
      hovedGaettet: gaettet,
    })
  }

  return ud
    .sort((a, b) => b.postingDate.localeCompare(a.postingDate) || b.productionNo.localeCompare(a.productionNo))
    .slice(0, antal)
}

// ─── Igangværende produktioner + folk ────────────────────────────────────────

export interface Medarbejder { navn: string; lonnr: string; initialer: string }

export interface LinjeProduktion {
  no: string; description: string
  afsluttet: boolean
  /** Kun på afsluttede: hvem der var på linjen da ordren blev afsluttet. */
  folk: Medarbejder[]
}
export interface ProduktionLinje {
  jobNo: string; jobNavn: string
  produktioner: LinjeProduktion[]
  /** Hvem der er stemplet ind på linjen lige nu — vi skelner ikke pr. produktion. */
  folk: Medarbejder[]
}
export interface ProduktionNu {
  linjer:    ProduktionLinje[]
  udenLinje: LinjeProduktion[]
}

export interface LinjeTimer {
  jobNo: string; jobNavn: string | null; timer: number; personer: number
  loenKr: number | null
}

export async function produktionNu(): Promise<ProduktionNu> {
  const alle = await bcHent("prodOrders", { "$filter": "productionStarted eq true", "$top": "500" })

  // Samme varenummer-interval som udbytterne. Røgeri ligger over 40000 og skal
  // IKKE med: det står som "startet" i dagevis, fordi det først færdiggøres
  // dagen efter (Claus 2026-09-08).
  const idag = copenhagenDato()
  const ordrer = alle.filter(o => {
    if (!iVaresortiment(o.itemNo)) return false
    if (!o.afsluttet) return true
    // Afsluttede tages kun med samme dag — ellers vokser skærmen i det uendelige.
    return o.afsluttetKl ? danskDato(o.afsluttetKl) === idag : false
  })

  const navne = new Map<string, string>()
  for (const t of await timerPrJob(idag)) if (t.jobNavn) navne.set(t.jobNr, t.jobNavn)

  const linjer = new Map<string, ProduktionLinje>()
  const udenLinje: LinjeProduktion[] = []

  for (const o of ordrer) {
    const jobNo = o.danTimeJobNo ? String(o.danTimeJobNo) : ""
    const afsluttet = Boolean(o.afsluttet)

    // Kun afsluttede bærer egne initialer — hvem der stod på linjen da ordren
    // blev lukket. De aktive deler linjens folk, for vi skelner ikke pr. produktion.
    let folk: Medarbejder[] = []
    if (afsluttet && jobNo && o.afsluttetKl) {
      folk = tilMedarbejdere(await hvemVarPaaJob(jobNo, danskDato(o.afsluttetKl), danskKlokken(o.afsluttetKl)))
    }

    const prod: LinjeProduktion = {
      no: String(o.no), description: String(o.description ?? ""), afsluttet, folk,
    }
    if (!jobNo) { udenLinje.push(prod); continue }

    let l = linjer.get(jobNo)
    if (!l) {
      l = { jobNo, jobNavn: navne.get(jobNo) ?? `job ${jobNo}`, produktioner: [], folk: [] }
      linjer.set(jobNo, l)
    }
    l.produktioner.push(prod)
  }

  // Linjens folk = dem der er stemplet ind lige nu. Ét opslag pr. linje.
  for (const l of Array.from(linjer.values())) {
    l.folk = tilMedarbejdere(await hvemErPaaJobNu(l.jobNo))
    l.produktioner.sort((a, b) => Number(a.afsluttet) - Number(b.afsluttet) || a.no.localeCompare(b.no))
  }

  return {
    linjer: Array.from(linjer.values()).sort((a, b) => b.folk.length - a.folk.length ||
                                                      a.jobNavn.localeCompare(b.jobNavn, "da")),
    udenLinje,
  }
}
