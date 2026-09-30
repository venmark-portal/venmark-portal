// Outlook-kalendere til info-skærmen og til 3-måneders-oversigten.
//
// Læser med APPLIKATIONS-tilladelsen Calendars.Read, altså uden en bruger
// bagved. Den giver adgang til ALLE postkasser i tenanten — begrænsningen til
// bestemte postkasser sker med en Application Access Policy i Exchange, ikke
// her. Indtil den er sat op, henter vi kun kalendere for brugere med en
// postkasse og springer dem uden aftaler over.

const GRAPH = 'https://graph.microsoft.com/v1.0'

export interface Aftale {
  id:       string
  person:   string
  emne:     string
  /** ISO i dansk tid. */
  start:    string
  slut:     string
  heledag:  boolean
  sted:     string
  /** Aflyst men stadig i kalenderen. */
  aflyst:   boolean
}

export interface KalenderSvar {
  aftaler:  Aftale[]
  /** Personer der har mindst én aftale i perioden — til farver og filtre. */
  personer: string[]
  mangler?: string
}

async function graphToken(): Promise<string> {
  const tenant = process.env.BC_TENANT_ID!
  const id     = process.env.GRAPH_CLIENT_ID     ?? process.env.BC_CLIENT_ID!
  const secret = process.env.GRAPH_CLIENT_SECRET ?? process.env.BC_CLIENT_SECRET!

  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'client_credentials', client_id: id, client_secret: secret,
      scope: 'https://graph.microsoft.com/.default',
    }),
    cache: 'no-store',   // aldrig cache et token-svar (heller ikke en 401)
  })
  if (!res.ok) throw new Error(`Graph-token ${res.status}`)
  return (await res.json()).access_token
}

export class TilladelseMangler extends Error {}

async function graphHent(sti: string, token: string, tidszone = false): Promise<any[] | null> {
  const ud: any[] = []
  let url: string | null = `${GRAPH}${sti}`
  let sider = 0
  while (url && sider++ < 20) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`, Accept: 'application/json',
    }
    // Beder Graph om at levere tidspunkterne i dansk tid frem for UTC, så vi
    // ikke skal omregne og risikere at ramme forkert hen over sommertid.
    if (tidszone) headers.Prefer = 'outlook.timezone="Romance Standard Time"'

    const res: Response = await fetch(url, { headers, cache: 'no-store' } as any)
    if (res.status === 401 || res.status === 403) throw new TilladelseMangler('Calendars.Read mangler administrator-samtykke')
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Graph ${sti.split('?')[0]} ${res.status}: ${(await res.text()).slice(0, 160)}`)
    const data = await res.json()
    ud.push(...(data.value ?? []))
    url = data['@odata.nextLink'] ?? null
  }
  return ud
}

/**
 * Aftaler for ALLE brugere med postkasse i perioden.
 *
 * `calendarView` bruges frem for `events`, fordi den folder gentagne aftaler ud
 * til de enkelte forekomster — ellers ville et ugentligt møde kun optræde én
 * gang, på den dag serien begyndte.
 *
 * Kalendere hentes parallelt i små hold: ét kald pr. bruger, og et helt hus ad
 * gangen ville ramme Graphs hastighedsgrænse.
 */
export async function hentAftaler(fra: string, til: string): Promise<KalenderSvar> {
  let token: string
  try {
    token = await graphToken()
  } catch (e) {
    return { aftaler: [], personer: [], mangler: e instanceof Error ? e.message : String(e) }
  }

  let brugere: any[] | null
  try {
    brugere = await graphHent(
      '/users?$select=id,displayName,mail,accountEnabled&$top=999', token,
    )
  } catch (e) {
    if (e instanceof TilladelseMangler) return { aftaler: [], personer: [], mangler: e.message }
    throw e
  }

  // Kun aktive konti med postkasse. Delte postkasser og ressourcer har også mail
  // og kommer derfor med — det er med vilje, et mødelokale er værd at se.
  const med = (brugere ?? []).filter(u => u.mail && u.accountEnabled !== false)

  const aftaler: Aftale[] = []
  let tilladelseFejl: string | null = null
  const HOLD = 8

  for (let i = 0; i < med.length; i += HOLD) {
    const hold = med.slice(i, i + HOLD)
    await Promise.all(hold.map(async u => {
      try {
        const sti = `/users/${encodeURIComponent(u.id)}/calendarView` +
          `?startDateTime=${fra}T00:00:00&endDateTime=${til}T23:59:59` +
          `&$select=id,subject,start,end,isAllDay,location,isCancelled,showAs` +
          `&$orderby=start/dateTime&$top=200`
        const ev = await graphHent(sti, token, true)
        for (const e of ev ?? []) {
          // Fri/foreløbig markering ("free") er typisk noget man har sat på sig
          // selv og ikke en aftale andre skal forholde sig til.
          if (String(e.showAs ?? '') === 'free') continue
          aftaler.push({
            id:      String(e.id ?? ''),
            person:  String(u.displayName ?? u.mail),
            emne:    String(e.subject ?? '(uden emne)'),
            start:   String(e.start?.dateTime ?? ''),
            slut:    String(e.end?.dateTime ?? ''),
            heledag: e.isAllDay === true,
            sted:    String(e.location?.displayName ?? ''),
            aflyst:  e.isCancelled === true,
          })
        }
      } catch (e) {
        // Én postkasse uden adgang må ikke tage hele oversigten med sig.
        if (e instanceof TilladelseMangler) tilladelseFejl = e.message
      }
    }))
  }

  if (aftaler.length === 0 && tilladelseFejl) {
    return { aftaler: [], personer: [], mangler: tilladelseFejl }
  }

  aftaler.sort((a, b) => a.start.localeCompare(b.start))
  return {
    aftaler,
    personer: Array.from(new Set(aftaler.map(a => a.person))).sort(),
  }
}

/** Dagens og morgendagens aftaler — til skærmen. */
export async function kalenderIDagOgIMorgen(): Promise<KalenderSvar> {
  const dk = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' })
  const idag = dk.format(new Date())
  const imorgen = dk.format(new Date(Date.now() + 864e5))
  return hentAftaler(idag, imorgen)
}
