// Pakkeristatus til info-skærmen i pakkeriet.
//
// Kilden er portalSalesLines (BC-side 50xxx over Sales Line), som KUN indeholder
// ÅBNE salgslinjer. Når en ordre er leveret/bogført forsvinder linjerne — tallene
// her er derfor "hvad står der tilbage i dag", ikke en historik.

import { getAccessToken, bcPortalBaseUrl } from '@/lib/businesscentral'

export interface PakkerRaekke {
  /** PackedBy fra salgslinjen, fx "6 PATRICK". */
  pakker:  string
  linjer:  number
  /** Af dem: hvor mange der har fået scannet mindst én kasse. */
  scannet: number
}

export interface PakkeriStatus {
  dato:            string
  ordrerIAlt:      number
  /** Ordrer hvor ingen linje endnu har en pakker på. */
  ordrerUdenPakker: number
  linjerIAlt:      number
  /** Linjer uden pakker — det der mangler at blive taget fat på. */
  aabneLinjer:     number
  pakkere:         PakkerRaekke[]
}

/**
 * Henter ALLE åbne salgslinjer med afsendelse på `dato`.
 *
 * Uden $top: beder man BC om et bestemt antal, svarer den med præcis så mange og
 * INGEN nextLink, så løkken stopper efter første side og resten findes aldrig.
 * Samme fælde som i getItemCategories og afvistLines.
 */
async function hentLinjer(dato: string): Promise<any[]> {
  const token  = await getAccessToken()
  const filter = encodeURIComponent(`type eq 'Item' and shipmentDate eq ${dato}`)
  const select = '$select=documentNo,lineNo,packedBy,packedQty,portalLineStatus,shipmentDate'

  const ud: any[] = []
  let url: string | null = `${bcPortalBaseUrl()}/portalSalesLines?$filter=${filter}&${select}`
  let sider = 0
  while (url && sider++ < 60) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
    } as any)
    if (!res.ok) throw new Error(`BC portalSalesLines fejl (${res.status}): ${(await res.text()).slice(0, 160)}`)
    const data = await res.json()
    ud.push(...(data.value ?? []))
    url = data['@odata.nextLink'] ?? null
  }
  return ud
}

export async function pakkeriStatus(dato: string): Promise<PakkeriStatus> {
  const linjer = await hentLinjer(dato)

  const harPakker = (l: any) => String(l.packedBy ?? '').trim() !== ''

  // Pr. ordre: er der overhovedet taget fat på den?
  const ordrer = new Map<string, boolean>()   // documentNo → mindst én linje har pakker
  for (const l of linjer) {
    const nr = String(l.documentNo ?? '')
    if (!nr) continue
    ordrer.set(nr, (ordrer.get(nr) ?? false) || harPakker(l))
  }

  const pr = new Map<string, PakkerRaekke>()
  for (const l of linjer) {
    if (!harPakker(l)) continue
    const navn = String(l.packedBy).trim()
    const r = pr.get(navn) ?? { pakker: navn, linjer: 0, scannet: 0 }
    r.linjer++
    // packedQty = Portal Scanned Qty. Er den 0, er linjen sat som pakket i hånden
    // uden at kasserne er scannet — det er netop forskellen der skal kunne ses.
    if (Number(l.packedQty ?? 0) > 0) r.scannet++
    pr.set(navn, r)
  }

  return {
    dato,
    ordrerIAlt:       ordrer.size,
    ordrerUdenPakker: Array.from(ordrer.values()).filter(taget => !taget).length,
    linjerIAlt:       linjer.length,
    aabneLinjer:      linjer.filter(l => !harPakker(l)).length,
    pakkere:          Array.from(pr.values()).sort((a, b) => b.linjer - a.linjer),
  }
}
