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
  /** Sat når logtabellen endnu ikke findes i BC. */
  mangler?:         string
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
    dato, ordrerIAlt: 0, ordrerUdenPakker: 0, linjerIAlt: 0, aabneLinjer: 0, pakkere: [],
  }

  const logFilter = encodeURIComponent(`shipmentDate eq ${dato} and deleted eq false`)
  const aabenFilter = encodeURIComponent(`type eq 'Item' and shipmentDate eq ${dato}`)

  const [log, aabne] = await Promise.all([
    hent(`salesEntries?$filter=${logFilter}&$select=documentNo,lineNo,packedBy,scanned`),
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

  const pr = new Map<string, PakkerRaekke>()
  for (const r of log) {
    if (!harPakker(r)) continue
    const navn = String(r.packedBy).trim()
    const p = pr.get(navn) ?? { pakker: navn, linjer: 0, scannet: 0 }
    p.linjer++
    // scanned blev sat da pakkeren satte sig på linjen. Er den falsk, er linjen
    // meldt pakket i hånden uden at kasserne blev scannet — netop den forskel
    // skal kunne ses fra gulvet.
    if (r.scanned === true) p.scannet++
    pr.set(navn, p)
  }

  return {
    dato,
    ordrerIAlt:       ordrer.size,
    ordrerUdenPakker: Array.from(ordrer.values()).filter(taget => !taget).length,
    linjerIAlt:       log.length,
    // ── Hvad mangler? Kun åbne linjer; en bogført linje er færdig. ──
    aabneLinjer:      (aabne ?? []).filter(l => !harPakker(l)).length,
    pakkere:          Array.from(pr.values()).sort((a, b) => b.linjer - a.linjer),
  }
}
