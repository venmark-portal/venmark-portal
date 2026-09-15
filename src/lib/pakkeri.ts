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
import { timerPrJob } from '@/lib/dantime'

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
  /** Stemplede arbejdstimer i pakkeriet i dag (Dan-Time). */
  arbejdstimer:     number | null
  /** Pakkede linjer pr. stemplet arbejdstime — det rigtige produktivitetstal. */
  linjerPrTime:     number | null
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

export async function pakkeriStatus(dato: string, jobNr = '16'): Promise<PakkeriStatus> {
  const tom: PakkeriStatus = {
    dato, ordrerIAlt: 0, ordrerUdenPakker: 0, linjerIAlt: 0, aabneLinjer: 0,
    pakkere: [], timer: [], arbejdstimer: null, linjerPrTime: null,
  }

  const logFilter = encodeURIComponent(`shipmentDate eq ${dato} and deleted eq false`)
  const aabenFilter = encodeURIComponent(`type eq 'Item' and shipmentDate eq ${dato}`)

  const [log, aabne, jobtimer] = await Promise.all([
    hent(`salesEntries?$filter=${logFilter}&$select=documentNo,lineNo,packedBy,packedDateTime,scanned`),
    hent(`portalSalesLines?$filter=${aabenFilter}&$select=documentNo,lineNo,packedBy`),
    timerPrJob(dato).catch(() => []),
  ])

  if (log === null) return { ...tom, mangler: 'BC-appen mangler salesEntries (side 50451)' }

  const navnAf = (r: any) => String(r.packedBy ?? '').trim()

  // ── Flet de to kilder PR. LINJE ────────────────────────────────────────────
  // Ingen af dem er komplet alene:
  //   loggen mangler pakkeren på linjer der blev auto-udfyldt ved etiketudskrift
  //     (den vej bruger Modify(false), som ikke når vores subscriber), og
  //   de åbne linjer mangler alt der allerede er bogført.
  // Nøglen er ordre+linjenr., så en linje kun tælles én gang. Loggen vinder når
  // begge har noget, for kun den kender `scanned` og pakketidspunktet.
  type Linje = { pakker: string; scannet: boolean; tid: number | null }
  const linjer = new Map<string, Linje>()

  for (const r of aabne ?? []) {
    const key = `${r.documentNo}|${r.lineNo}`
    linjer.set(key, { pakker: navnAf(r), scannet: false, tid: null })
  }
  for (const r of log) {
    const key = `${r.documentNo}|${r.lineNo}`
    const fra = linjer.get(key)
    const pakker = navnAf(r) || fra?.pakker || ''
    linjer.set(key, {
      pakker,
      scannet: r.scanned === true,
      tid: r.packedDateTime ? danskTime(String(r.packedDateTime)) : null,
    })
  }

  // ── Ordrer ─────────────────────────────────────────────────────────────────
  const ordrer = new Map<string, boolean>()   // documentNo → mindst én linje har pakker
  for (const [key, l] of Array.from(linjer)) {
    const nr = key.split('|')[0]
    if (!nr) continue
    ordrer.set(nr, (ordrer.get(nr) ?? false) || l.pakker !== '')
  }

  // "Uden pakker" skal betyde "ikke taget fat på endnu", altså noget der ligger
  // og venter. En ordre der allerede er bogført er per definition færdig, uanset
  // hvad loggen nåede at fange — så den tæller kun med hvis den stadig har åbne
  // linjer. Uden det tog gamle, bogførte ordrer plads i tallet for evigt.
  const ordrerMedAabne = new Set((aabne ?? []).map(l => String(l.documentNo ?? '')))

  // ── Pr. pakker ─────────────────────────────────────────────────────────────
  const pr      = new Map<string, PakkerRaekke>()
  const timerPr = new Map<string, Set<number>>()   // pakker → klokketimer i gang
  const timer   = new Map<number, number>()        // klokketime → linjer i alt

  for (const l of Array.from(linjer.values())) {
    if (!l.pakker) continue
    const p = pr.get(l.pakker) ?? { pakker: l.pakker, linjer: 0, scannet: 0, prTime: null, sidsteTime: null }
    p.linjer++
    if (l.scannet) p.scannet++

    if (l.tid !== null) {
      const set = timerPr.get(l.pakker) ?? new Set<number>()
      set.add(l.tid)
      timerPr.set(l.pakker, set)
      timer.set(l.tid, (timer.get(l.tid) ?? 0) + 1)
      p.sidsteTime = p.sidsteTime === null ? l.tid : Math.max(p.sidsteTime, l.tid)
    }
    pr.set(l.pakker, p)
  }

  for (const p of Array.from(pr.values())) {
    const aktive = timerPr.get(p.pakker)?.size ?? 0
    // Uden mindst én hel klokketime bag sig er tallet støj — så vis hellere
    // ingenting end et gæt.
    p.prTime = aktive > 0 ? Math.round(p.linjer / aktive) : null
  }

  // ── Produktivitet mod STEMPLEDE timer (Dan-Time job 16 "Pakkeriet") ───────
  // Det er det rigtige nævnertal: klokketimer siger kun hvornår der blev pakket,
  // ikke hvor mange mennesker der stod der imens.
  const job = (jobtimer ?? []).find(j => j.jobNr === jobNr)
  const arbejdstimer = job && job.timer > 0 ? job.timer : null
  const pakkedeLinjer = Array.from(linjer.values()).filter(l => l.pakker !== '').length

  return {
    dato,
    ordrerIAlt:       ordrer.size,
    ordrerUdenPakker: Array.from(ordrer.entries())
                        .filter(([nr, taget]) => !taget && ordrerMedAabne.has(nr)).length,
    linjerIAlt:       linjer.size,
    // En bogført linje er færdig og skal ikke stå som "mangler".
    aabneLinjer:      (aabne ?? []).filter(l => !navnAf(l)).length,
    pakkere:          Array.from(pr.values()).sort((a, b) => b.linjer - a.linjer),
    timer:            Array.from(timer.entries())
                        .map(([time, linjer]) => ({ time, linjer }))
                        .sort((a, b) => a.time - b.time),
    arbejdstimer,
    linjerPrTime:     arbejdstimer ? Math.round(pakkedeLinjer / arbejdstimer) : null,
  }
}
