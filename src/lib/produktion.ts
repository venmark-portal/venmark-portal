// Produktionsdata til skærmene: udbytte på lukkede montager, og hvad der kører nu.

import { getAccessToken, bcPortalBaseUrl } from '@/lib/businesscentral'
import { hvemErPaaJobNu, timerPrJob, copenhagenDato } from '@/lib/dantime'

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

export interface UdbytteProdukt {
  itemNo: string; description: string; yieldPct: number; qty: number
}
export interface UdbytteMontage {
  productionNo: string; postingDate: string; rawQty: number; produkter: UdbytteProdukt[]
}

/**
 * De seneste `antal` bogførte montager med udbytte pr. produkt.
 *
 * Bemærk: kun produkter i varenummer-intervallet vises, så en montages produkter
 * her ikke nødvendigvis er ALLE dens produkter. Derfor viser skærmen udbytte pr.
 * produkt — ikke en sum, der ville se ud som om noget manglede.
 */
export async function sidsteUdbytter(antal = 10): Promise<UdbytteMontage[]> {
  // Én uge ad gangen, nyeste først, indtil vi har nok montager.
  //
  // Hvorfor ikke bare ét stort kald: BC sider resultatet op uanset $top og
  // returnerer i NØGLErækkefølge (produktionsnr.), og nextLinks udløber. Et bredt
  // kald gav derfor de ÆLDSTE montager — skærmen viste 31. august som "senest
  // lukkede", selvom der var bogført montager samme dag. Et vindue på en uge er
  // ~500 rækker og passer i én side.
  const dag = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)
  const raekker: any[] = []
  const pr = new Map<string, UdbytteMontage>()

  for (let uge = 0; uge < 8; uge++) {
    const side = await bcHent('prodYields', {
      '$filter': `postingDate ge ${dag(7 * (uge + 1))} and postingDate le ${dag(7 * uge)}`,
      '$top':    '1000',
    })
    raekker.push(...side)
    const nok = new Set(raekker
      .filter(r => iVaresortiment(r.itemNo) && Number(r.rawQty) >= MIN_RAAVARE_KG && Number(r.actualYieldPct) > 0)
      .map(r => r.productionNo)).size
    if (nok >= antal) break
  }

  const brugbare = raekker.filter(r =>
    iVaresortiment(r.itemNo) && Number(r.rawQty) >= MIN_RAAVARE_KG && Number(r.actualYieldPct) > 0)

  for (const r of brugbare) {
    let m = pr.get(r.productionNo)
    if (!m) {
      m = { productionNo: r.productionNo, postingDate: String(r.postingDate).slice(0, 10), rawQty: Number(r.rawQty), produkter: [] }
      pr.set(r.productionNo, m)
    }
    m.produkter.push({
      itemNo:      String(r.itemNo),
      description: String(r.description ?? ''),
      yieldPct:    Number(r.actualYieldPct),
      qty:         Number(r.actualQty),
    })
  }

  return Array.from(pr.values())
    .sort((a, b) =>
      b.postingDate.localeCompare(a.postingDate) ||
      b.productionNo.localeCompare(a.productionNo))
    .slice(0, antal)
    .map(m => ({ ...m, produkter: m.produkter.sort((a, b) => b.yieldPct - a.yieldPct) }))
}

// ─── Igangværende produktioner + folk ────────────────────────────────────────

export interface Medarbejder { navn: string; lonnr: string }
export interface AktivProduktion {
  no: string; description: string; jobNo: string | null; jobNavn: string | null
  familyCode: string | null; quantity: number; folk: Medarbejder[]
}
export interface LinjeTimer {
  jobNo: string; jobNavn: string | null; timer: number; personer: number
  loenKr: number | null
}
export interface ProduktionNu {
  produktioner: AktivProduktion[]
  udenJob:      number
  linjer:       LinjeTimer[]
  timepris:     number
}

export async function produktionNu(): Promise<ProduktionNu> {
  const ordrer = await bcHent('prodOrders', {
    '$filter': 'productionStarted eq true and afsluttet eq false', '$top': '200',
  })

  // Timeprisen kommer fra Virksomhedsoplysninger — samme sats som styklisteberegningen.
  let timepris = 0
  try {
    const c = await bcHent('costSetups', { '$top': '1' })
    timepris = Number(c[0]?.avgHourlyWage ?? 0)
  } catch { /* satsen er pynt på skærmen — den må ikke vælte resten */ }

  const jobNavne = new Map<string, string | null>()
  const produktioner: AktivProduktion[] = []
  for (const o of ordrer) {
    const jobNo = o.danTimeJobNo ? String(o.danTimeJobNo) : null
    const folk  = jobNo ? await hvemErPaaJobNu(jobNo) : []
    produktioner.push({
      no:          String(o.no),
      description: String(o.description ?? ''),
      jobNo,
      jobNavn:     null,
      familyCode:  o.familyCode ? String(o.familyCode) : null,
      quantity:    Number(o.quantity ?? 0),
      folk:        folk.map(p => ({ navn: p.navn, lonnr: p.lonnr })),
    })
    if (jobNo) jobNavne.set(jobNo, null)
  }

  const timer = await timerPrJob(copenhagenDato())
  for (const t of timer) jobNavne.set(t.jobNr, t.jobNavn)
  for (const p of produktioner) if (p.jobNo) p.jobNavn = jobNavne.get(p.jobNo) ?? null

  return {
    produktioner: produktioner.sort((a, b) => b.folk.length - a.folk.length),
    udenJob:      produktioner.filter(p => !p.jobNo).length,
    linjer: timer.map(t => ({
      jobNo: t.jobNr, jobNavn: t.jobNavn, timer: t.timer, personer: t.personer,
      loenKr: timepris > 0 ? Math.round(t.timer * timepris) : null,
    })),
    timepris,
  }
}
