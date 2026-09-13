// Pakkeristatus til info-skærmen i pakkeriet.
//
// Tallene kommer BEVIDST fra to kilder, fordi de svarer på to forskellige ting:
//
//   Hvad er der lavet?   → logtabellen (salesEntries, BC-side 50451)
//        Logrækken skrives når linjen oprettes og bliver stående, også når ordren
//        bogføres. Uden den ville pakkernes tal falde hen over dagen, efterhånden
//        som de færdige ordrer blev bogført og forsvandt ud af Sales Line.
//
//   Hvad mangler?        → åbne salgslinjer (portalSalesLines)
//        En bogført linje er pr. definition ikke åben længere, så den skal netop
//        IKKE tælle med i "mangler". Den kilde er rigtig som den er.

import { getAccessToken, bcPortalBaseUrl } from '@/lib/businesscentral'

export interface PakkerRaekke {
  /** PackedBy fra salgslinjen, fx "6 PATRICK". */
  pakker:  string
  linjer:  number
  /** Af dem: hvor mange der havde scannet mindst én kasse. */
  scannet: number
  /**
   * Linjer pr. time, regnet som linjer delt med antal KLOKKETIMER hvor pakkeren
   * faktisk har pakket noget. Bevidst ikke "sidste minus første tidspunkt": har
   * man pakket 5 linjer på 10 minutter og så holdt pause, ville det give 30 i
   * timen og være det rene opspind. Null indtil der er en hel time at regne på.
   */
  prTime:  number | null
  /** Klokketimen hvor pakkeren sidst var i gang, fx 9 for 09:00-09:59. */
  sidsteTime: number | null
}

/** Linjer pakket i hver klokketime i dag — hele pakkeriet under ét. */
export interface TimeSoejle {
  time:   number   // 0-23, dansk tid
  linjer: number
}

export interface PakkeriStatus {
  dato:             string
  /** Ordrer til afsendelse i dag — også dem der allerede er bogført. */
  ordrerIAlt:       number
  /** Ordrer hvor ingen linje endnu har en pakker på. */
  ordrerUdenPakker: number
  linjerIAlt:       number
  /** Linjer der stadig er åbne og uden pakker — det der mangler at blive taget fat på. */
  aabneLinjer:      number
  pakkere:          PakkerRaekke[]
  /** Kun timer hvor der rent faktisk blev pakket — ingen tomme søjler. */
  timer:            TimeSoejle[]
  /** Sat når logtabellen endnu ikke findes i BC. */
  mangler?:         string
}

/** Klokketimen i dansk tid for et ISO-tidsstempel fra BC. */
function danskTime(iso: string): number | null {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const t = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Copenhagen', hour: '2-digit', hour12: false,
  }).format(d)
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * Følger nextLink uden $top.
 *
 * Beder man BC om et bestemt antal, svarer den med præcis så mange og INGEN
 * nextLink — så løkken stopper efter første side og resten findes aldrig. Samme
 * fælde som i getItemCategories og afvistLines.
 *
 * Returnerer null ved 404, så en manglende BC-opdatering kan vises som netop det.
 */
async function hent(sti: string): Promise<any[] | null> {
  const token = await getAccessToken()
  const ud: any[] = []
  let url: string | null = `${bcPortalBaseUrl()}/${sti}`
  let sider = 0
  while (url && sider++ < 60) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
    } as any)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`BC ${sti.split('?')[0]} fejl (${res.status}): ${(await res.text()).slice(0, 160)}`)
    const data = await res.json()
    ud.push(...(data.value ?? []))
    url = data['@odata.nextLink'] ?? null
  }
  return ud
}

export async function pakkeriStatus(dato: string): Promise<PakkeriStatus> {
  const tom: PakkeriStatus = {
    dato, ordrerIAlt: 0, ordrerUdenPakker: 0, linjerIAlt: 0, aabneLinjer: 0, pakkere: [], timer: [],
  }

  const logFilter = encodeURIComponent(`shipmentDate eq ${dato} and deleted eq false`)
  const aabenFilter = encodeURIComponent(`type eq 'Item' and shipmentDate eq ${dato}`)

  const [log, aabne] = await Promise.all([
    hent(`salesEntries?$filter=${logFilter}&$select=documentNo,lineNo,packedBy,packedDateTime,scanned`),
    hent(`portalSalesLines?$filter=${aabenFilter}&$select=documentNo,lineNo,packedBy`),
  ])

  if (log === null) return { ...tom, mangler: 'BC-appen mangler salesEntries (side 50451)' }

  const harPakker = (r: any) => String(r.packedBy ?? '').trim() !== ''

  // ── Hvad er der lavet? Fra loggen, så bogførte ordrer stadig tæller med. ──
  const ordrer = new Map<string, boolean>()   // documentNo → mindst én linje har pakker
  for (const r of log) {
    const nr = String(r.documentNo ?? '')
    if (!nr) continue
    ordrer.set(nr, (ordrer.get(nr) ?? false) || harPakker(r))
  }

  const pr      = new Map<string, PakkerRaekke>()
  const timerPr = new Map<string, Set<number>>()   // pakker → klokketimer i gang
  const timer   = new Map<number, number>()        // klokketime → linjer i alt

  for (const r of log) {
    if (!harPakker(r)) continue
    const navn = String(r.packedBy).trim()
    const p = pr.get(navn) ?? { pakker: navn, linjer: 0, scannet: 0, prTime: null, sidsteTime: null }
    p.linjer++
    // scanned blev sat da pakkeren satte sig på linjen. Er den falsk, er linjen
    // meldt pakket i hånden uden at kasserne blev scannet — netop den forskel
    // skal kunne ses fra gulvet.
    if (r.scanned === true) p.scannet++

    const t = r.packedDateTime ? danskTime(String(r.packedDateTime)) : null
    if (t !== null) {
      const set = timerPr.get(navn) ?? new Set<number>()
      set.add(t)
      timerPr.set(navn, set)
      timer.set(t, (timer.get(t) ?? 0) + 1)
      p.sidsteTime = p.sidsteTime === null ? t : Math.max(p.sidsteTime, t)
    }
    pr.set(navn, p)
  }

  for (const p of Array.from(pr.values())) {
    const aktive = timerPr.get(p.pakker)?.size ?? 0
    // Uden mindst én hel klokketime bag sig er tallet støj — så vis hellere
    // ingenting end et gæt.
    p.prTime = aktive > 0 ? Math.round(p.linjer / aktive) : null
  }

  return {
    dato,
    ordrerIAlt:       ordrer.size,
    ordrerUdenPakker: Array.from(ordrer.values()).filter(taget => !taget).length,
    linjerIAlt:       log.length,
    // ── Hvad mangler? Kun åbne linjer; en bogført linje er færdig. ──
    aabneLinjer:      (aabne ?? []).filter(l => !harPakker(l)).length,
    pakkere:          Array.from(pr.values()).sort((a, b) => b.linjer - a.linjer),
    timer:            Array.from(timer.entries())
                        .map(([time, linjer]) => ({ time, linjer }))
                        .sort((a, b) => a.time - b.time),
  }
}
