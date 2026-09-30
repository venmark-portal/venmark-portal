// Sælgerstatistik til kontorskærmen: hvor mange salgslinjer hver sælger har lagt
// ind i dag, og hvor stor en del af dem der kom via Hurtig ordreindtastning.
//
// Kilden er BC-API'et `salesEntries` (side 50451) over logtabellen "VM Salgslinje
// Log". Den er LÆSE-KUN og adskilt fra den API-side portalen skriver ordrer igennem.
//
// Hvorfor en logtabel og ikke salgslinjerne selv: Sales Line indeholder kun ÅBNE
// linjer. Bogføres en ordre midt på dagen, forsvinder dens linjer — så ville
// dagens tal falde hen over dagen, og der ville ingen historik være bagud.
// Logrækken skrives når linjen oprettes og bliver stående.
//
// Ét forbehold: quickEntry sættes først fra den BC-version der indfører feltet,
// så procenten er kun retvisende fremad.

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
  /** Linjer pr. minut lige nu — talt over de seneste minutter. */
  prMinut:     number | null
  /** Hvor mange minutter tallet er talt over. */
  prMinutVindue: number
  /** Travleste minut i dag — hvad der er muligt når det spidser til. */
  topPrMinut:  number
  /** Sat når BC endnu ikke har API'et — så siger skærmen det i stedet for at vise 0. */
  mangler?:    string
}

export async function saelgerStat(): Promise<SaelgerStat> {
  // Logrækkens dato er BC's Today() — altså dansk arbejdsdag. Vi sammenligner
  // med dansk dato, ikke UTC, så døgnet ikke skifter en time for tidligt.
  const dato = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(new Date())
  const tom: SaelgerStat = {
    dato, linjerIAlt: 0, hurtigeIAlt: 0, saelgere: [],
    prMinut: null, prMinutVindue: 15, topPrMinut: 0,
  }

  const token  = await getAccessToken()
  const filter = encodeURIComponent(`createdDate eq ${dato} and deleted eq false`)
  // Intet $top — BC svarer med præcis det antal man beder om og INGEN nextLink,
  // så et loft ville afkorte tavst. Vi følger nextLink i stedet.
  let url: string | null = `${bcPortalBaseUrl()}/salesEntries?$filter=${filter}&$select=userId,salespersonCode,quickEntry,createdDateTime`

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
    const navn = String(r.salespersonCode || r.userId || '').trim() || 'ukendt'
    const s = pr.get(navn) ?? { saelger: navn, linjer: 0, hurtige: 0 }
    s.linjer++
    if (r.quickEntry === true) s.hurtige++
    pr.set(navn, s)
  }

  // ── Linjer pr. minut ───────────────────────────────────────────────────────
  // Tælles i rigtige minut-spande på oprettelsestidspunktet, ikke som et
  // gennemsnit over dagen: gennemsnittet ville drukne i frokostpauser og
  // stille timer og aldrig vise hvad der faktisk kan lade sig gøre.
  const VINDUE = 15                       // minutter bagud for "lige nu"
  const nu = Date.now()
  const spande = new Map<number, number>()  // minut siden epoke → antal linjer
  let iVindue = 0

  for (const r of raekker) {
    const t = new Date(String(r.createdDateTime ?? '')).getTime()
    if (isNaN(t)) continue
    const minut = Math.floor(t / 60000)
    spande.set(minut, (spande.get(minut) ?? 0) + 1)
    if (nu - t <= VINDUE * 60000) iVindue++
  }

  const topPrMinut = spande.size ? Math.max(...Array.from(spande.values())) : 0
  // Først når der ER sket noget i vinduet giver tallet mening. Nul linjer på et
  // kvarter er ikke "0 pr. minut", det er "ingen aktivitet" — og et nul ville
  // se ud som en måling.
  const prMinut = iVindue > 0 ? Math.round((iVindue / VINDUE) * 10) / 10 : null

  const saelgere = Array.from(pr.values()).sort((a, b) => b.linjer - a.linjer)
  return {
    dato,
    linjerIAlt:  raekker.length,
    hurtigeIAlt: raekker.filter(r => r.quickEntry === true).length,
    saelgere,
    prMinut,
    prMinutVindue: VINDUE,
    topPrMinut,
  }
}
