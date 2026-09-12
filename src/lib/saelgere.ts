// Sælgerstatistik til kontorskærmen: hvor mange salgslinjer hver sælger har lagt
// ind i dag, og hvor stor en del af dem der kom via Hurtig ordreindtastning.
//
// Kilden er BC-API'et `salesEntries` (side 50451), som er LÆSE-KUN og adskilt fra
// den API-side portalen skriver ordrer igennem.
//
// To ting værd at vide om tallene:
//  1. Kun ÅBNE salgslinjer findes i Sales Line. Er ordren leveret og bogført, er
//     linjerne væk — derfor er det "lagt ind i dag og står endnu", ikke historik.
//  2. quickEntry sættes først fra den BC-version der indfører feltet. Linjer fra
//     før det står som ikke-hurtig, så procenten er kun retvisende fremad.

import { getAccessToken, bcPortalBaseUrl } from '@/lib/businesscentral'

export interface SaelgerRaekke {
  saelger: string
  linjer:  number
  /** Af dem: oprettet via Hurtig ordreindtastning. */
  hurtige: number
}

export interface SaelgerStat {
  dato:        string
  linjerIAlt:  number
  hurtigeIAlt: number
  saelgere:    SaelgerRaekke[]
  /** Sat når BC endnu ikke har API'et — så siger skærmen det i stedet for at vise 0. */
  mangler?:    string
}

function startenAfDagen(): string {
  // Midnat dansk tid udtrykt i UTC, så filteret rammer den rigtige arbejdsdag.
  const nu    = new Date()
  const dansk = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(nu)
  // Danmark er UTC+1/+2. Vi trækker offsettet fra ved at lade JS regne det ud på
  // selve datoen frem for at hardkode sommertid.
  const midnatLokalt = new Date(`${dansk}T00:00:00`)
  const offsetMin    = midnatLokalt.getTimezoneOffset()
  return new Date(midnatLokalt.getTime() - offsetMin * 60000).toISOString().slice(0, 19) + 'Z'
}

export async function saelgerStat(): Promise<SaelgerStat> {
  const dato = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(new Date())
  const tom: SaelgerStat = { dato, linjerIAlt: 0, hurtigeIAlt: 0, saelgere: [] }

  const token  = await getAccessToken()
  const filter = encodeURIComponent(`createdDateTime ge ${startenAfDagen()}`)
  // Intet $top — BC svarer med præcis det antal man beder om og INGEN nextLink,
  // så et loft ville afkorte tavst. Vi følger nextLink i stedet.
  let url: string | null = `${bcPortalBaseUrl()}/salesEntries?$filter=${filter}&$select=createdBy,salespersonCode,quickEntry,createdDateTime`

  const raekker: any[] = []
  let sider = 0
  while (url && sider++ < 60) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
    } as any)
    if (res.status === 404) {
      // API'et findes først fra den BC-version der indfører siden.
      return { ...tom, mangler: 'BC-appen mangler salesEntries (side 50451)' }
    }
    if (!res.ok) throw new Error(`BC salesEntries fejl (${res.status}): ${(await res.text()).slice(0, 160)}`)
    const data = await res.json()
    raekker.push(...(data.value ?? []))
    url = data['@odata.nextLink'] ?? null
  }

  const pr = new Map<string, SaelgerRaekke>()
  for (const r of raekker) {
    // Sælgerkoden er det folk kender hinanden på; brugernavnet er nødløsningen.
    const navn = String(r.salespersonCode || r.createdBy || '').trim() || 'ukendt'
    const s = pr.get(navn) ?? { saelger: navn, linjer: 0, hurtige: 0 }
    s.linjer++
    if (r.quickEntry === true) s.hurtige++
    pr.set(navn, s)
  }

  const saelgere = Array.from(pr.values()).sort((a, b) => b.linjer - a.linjer)
  return {
    dato,
    linjerIAlt:  raekker.length,
    hurtigeIAlt: raekker.filter(r => r.quickEntry === true).length,
    saelgere,
  }
}
